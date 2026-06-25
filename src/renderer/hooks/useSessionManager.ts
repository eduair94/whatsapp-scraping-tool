import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckSession } from '../types';
import { useElectronAPI } from './useElectronAPI';
import { categorizeResults } from '../utils/resultUtils';

interface SessionManagerState {
  sessions: CheckSession[];
  currentSession: CheckSession | null;
  isLoading: boolean;
  canResume: boolean;
  canPause: boolean;
}

export const useSessionManager = () => {
  const [state, setState] = useState<SessionManagerState>({
    sessions: [],
    currentSession: null,
    isLoading: false,
    canResume: false,
    canPause: false,
  });

  const electronAPI = useElectronAPI();

  const loadSessions = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      const savedHistory = await electronAPI.getSessions();
      setState((prev) => ({
        ...prev,
        sessions: savedHistory || [],
        isLoading: false,
      }));
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [electronAPI]);

  const selectSession = useCallback((session: CheckSession) => {
    setState((prev) => ({
      ...prev,
      currentSession: session,
      canResume:
        session.status === 'pending' ||
        session.status === 'running' ||
        session.status === 'cancelled',
      canPause: session.status === 'running',
    }));
  }, []);

  const pauseSession = useCallback(
    async (sessionArg?: CheckSession) => {
      const base = sessionArg || state.currentSession;
      if (!base || base.status !== 'running') {
        return;
      }

      try {
        await electronAPI.cancelCheck();

        const updatedSession = {
          ...base,
          status: 'cancelled' as const,
          pausedAt: new Date(),
        };
        await electronAPI.saveSession(updatedSession);

        setState((prev) => ({
          ...prev,
          currentSession: updatedSession,
          sessions: prev.sessions.map((s) =>
            s.id === updatedSession.id ? { ...s, ...updatedSession } : s
          ),
          canPause: false,
          canResume: true,
        }));
      } catch (error) {
        console.error('Failed to pause session:', error);
      }
    },
    [state.currentSession, electronAPI]
  );

  const resumeSession = useCallback(
    async (sessionArg?: CheckSession) => {
      const base = sessionArg || state.currentSession;
      const canResume =
        base &&
        (base.status === 'pending' ||
          base.status === 'running' ||
          base.status === 'cancelled');
      if (!base || !canResume) {
        return;
      }

      try {
        // List entries are lightweight summaries; load the full session so we
        // have its results / originalNumbers.
        const full = (await electronAPI.getSession(base.id)) || base;

        let numbersToCheck: {
          original: string;
          cleaned: string;
          isValid: boolean;
        }[] = [];

        if (full.status === 'pending' && full.originalNumbers) {
          numbersToCheck = full.originalNumbers.map((num) => ({
            original: num.original,
            cleaned: num.cleaned,
            isValid: num.isValid,
          }));
        } else {
          // Re-check everything that did not reach a definitive answer:
          // never-returned (pending) and throttled (rate-limited) numbers.
          const categorization = categorizeResults(full.results || []);
          numbersToCheck = [
            ...categorization.pendingResults,
            ...categorization.rateLimitedResults,
          ].map((result) => ({
            original: result.number,
            cleaned: result.number,
            isValid: true,
          }));
        }

        if (numbersToCheck.length === 0) {
          return;
        }

        const updatedSession = {
          ...full,
          status: 'running' as const,
          lastResumedAt: new Date(),
        };
        await electronAPI.saveSession(updatedSession);

        await electronAPI.startBulkCheck(
          numbersToCheck,
          full.settings,
          full.id
        );

        setState((prev) => ({
          ...prev,
          currentSession: updatedSession,
          sessions: prev.sessions.map((s) =>
            s.id === updatedSession.id ? { ...s, ...updatedSession } : s
          ),
          canResume: false,
          canPause: true,
        }));
      } catch (error) {
        console.error('Failed to resume session:', error);
      }
    },
    [state.currentSession, electronAPI]
  );

  const addSession = useCallback((session: CheckSession) => {
    setState((prev) => ({
      ...prev,
      sessions: [session, ...prev.sessions.slice(0, 49)], // Keep last 50 sessions
    }));
  }, []);

  const updateCurrentSession = useCallback((updates: Partial<CheckSession>) => {
    setState((prev) => ({
      ...prev,
      currentSession: prev.currentSession
        ? { ...prev.currentSession, ...updates }
        : null,
    }));
  }, []);

  const updateSessionById = useCallback(
    (sessionId: string, updates: Partial<CheckSession>) => {
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((session) =>
          session.id === sessionId ? { ...session, ...updates } : session
        ),
        currentSession:
          prev.currentSession?.id === sessionId
            ? { ...prev.currentSession, ...updates }
            : prev.currentSession,
      }));
    },
    []
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const success = await electronAPI.deleteSession(sessionId);
        if (success) {
          setState((prev) => ({
            ...prev,
            sessions: prev.sessions.filter((s) => s.id !== sessionId),
          }));
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to delete session:', error);
        return false;
      }
    },
    [electronAPI]
  );

  const clearAllSessions = useCallback(async () => {
    try {
      // Delete all sessions from storage
      const deletePromises = state.sessions.map((session) =>
        electronAPI.deleteSession(session.id)
      );
      await Promise.all(deletePromises);

      setState((prev) => ({
        ...prev,
        sessions: [],
        currentSession: null,
      }));
      return true;
    } catch (error) {
      console.error('Failed to clear sessions:', error);
      return false;
    }
  }, [electronAPI, state.sessions]);

  const toggleStarSession = useCallback(
    async (session: CheckSession) => {
      try {
        const updatedSession = { ...session, isStarred: !session.isStarred };
        await electronAPI.saveSession(updatedSession);
        updateSessionById(session.id, { isStarred: !session.isStarred });
        return true;
      } catch (error) {
        console.error('Failed to toggle star status:', error);
        return false;
      }
    },
    [electronAPI, updateSessionById]
  );

  const exportSession = useCallback(
    async (session: CheckSession) => {
      try {
        const result = await electronAPI.exportResults(session.id, {
          format: 'xlsx',
          includeDetails: true,
        });
        return result.success;
      } catch (error) {
        console.error('Failed to export session:', error);
        return false;
      }
    },
    [electronAPI]
  );

  const getFullSession = useCallback(
    (sessionId: string) => electronAPI.getSession(sessionId),
    [electronAPI]
  );

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Memoize so consumers (and anything depending on this object) get a stable
  // reference that only changes when the underlying state/callbacks change.
  return useMemo(
    () => ({
      ...state,
      loadSessions,
      selectSession,
      pauseSession,
      resumeSession,
      addSession,
      updateCurrentSession,
      updateSessionById,
      deleteSession,
      clearAllSessions,
      toggleStarSession,
      exportSession,
      getFullSession,
    }),
    [
      state,
      loadSessions,
      selectSession,
      pauseSession,
      resumeSession,
      addSession,
      updateCurrentSession,
      updateSessionById,
      deleteSession,
      clearAllSessions,
      toggleStarSession,
      exportSession,
      getFullSession,
    ]
  );
};
