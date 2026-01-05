'use client';

import { useEffect, useState } from 'react';

const SESSION_KEY = 'comms-coach-session-id';

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function useSessionId() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      let currentSessionId = window.sessionStorage.getItem(SESSION_KEY);
      if (!currentSessionId) {
        currentSessionId = generateSessionId();
        window.sessionStorage.setItem(SESSION_KEY, currentSessionId);
      }
      setSessionId(currentSessionId);
    }
  }, []);

  return sessionId;
}
