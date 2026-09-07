'use client';
import { useEffect, useRef, useState } from 'react';
import type { CompanionMessage, CompanionSnapshot, CompanionPick, PickAction } from './companion-types';

export function useCompanion(snapshot: CompanionSnapshot, apply: (action: PickAction) => CompanionPick[]) {
  const current = useRef({ snapshot, apply });
  current.current = { snapshot, apply };
  const popup = useRef<Window | null>(null);
  const [error, setError] = useState('');
  const handled = useRef(new Set<string>());
  const send = (message: CompanionMessage) => {
    if (window.draftroomDesktop) window.draftroomDesktop.sendCompanionMessage(message);
    else if (popup.current && !popup.current.closed) popup.current.postMessage(message, window.location.origin);
  };
  useEffect(() => {
    const receive = (message: CompanionMessage) => {
      if (message?.channel !== 'draft-companion') return;
      let error = '';
      if (message.type === 'command' && message.action) {
        try {
          if (!message.requestId || handled.current.has(message.requestId)) throw new Error('This action was already handled. Review the latest picks.');
          handled.current.add(message.requestId);
          if (handled.current.size > 500) handled.current.delete(handled.current.values().next().value!);
          if (!current.current.snapshot.active) throw new Error('Return to the draft room in the full program before recording picks.');
          const picks = current.current.apply(message.action);
          current.current.snapshot = { ...current.current.snapshot, picks };
        } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not record the pick.'; }
      }
      if (message.type === 'hello' || message.type === 'command') send({ channel: 'draft-companion', type: 'snapshot', snapshot: current.current.snapshot, requestId: message.requestId, error });
    };
    const listener = (event: MessageEvent) => {
      if (popup.current && event.origin === window.location.origin && event.source === popup.current) receive(event.data);
    };
    const dispose = window.draftroomDesktop?.onCompanionMessage(receive);
    window.addEventListener('message', listener);
    return () => { dispose?.(); window.removeEventListener('message', listener); };
  }, []);
  useEffect(() => { send({ channel: 'draft-companion', type: 'snapshot', snapshot }); }, [snapshot]);
  const open = async () => {
    setError('');
    if (window.draftroomDesktop) {
      try { await window.draftroomDesktop.openCompanion(); }
      catch { setError('Could not open the pick window. Please try again.'); }
      return;
    }
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    popup.current = window.open(new URL('/companion', window.location.href), '_blank', 'popup=yes,width=430,height=760,resizable=yes,scrollbars=yes');
    if (!popup.current) setError('Your browser blocked the window. Allow pop-ups for this site, then try again.');
  };
  return { open, error };
}
