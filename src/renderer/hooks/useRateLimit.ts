import { useCallback, useEffect, useState } from 'react';
import { RateLimitInfo } from '../types';
import { useElectronAPI } from './useElectronAPI';

export const useRateLimit = () => {
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(
    null
  );
  const [isVisible, setIsVisible] = useState(false);
  const electronAPI = useElectronAPI();

  const updateRateLimit = useCallback((info: RateLimitInfo) => {
    setRateLimitInfo(info);
    // Show the bar once usage is meaningful. Guard against limit === 0 (API has
    // not reported a limit yet) which would otherwise make `limit * 0.9` zero.
    const used = info.used ?? 0;
    const hasLimit = info.limit > 0;
    setIsVisible(used > 0 || (hasLimit && info.remaining < info.limit * 0.9));
  }, []);

  useEffect(() => {
    const unsubscribe = electronAPI.onRateLimitUpdate(updateRateLimit);
    return unsubscribe;
  }, [electronAPI, updateRateLimit]);

  const getRemainingTimeText = useCallback(() => {
    if (!rateLimitInfo?.reset) return '';

    const now = Math.floor(Date.now() / 1000);
    const diffSeconds = rateLimitInfo.reset - now;

    if (diffSeconds <= 0) return 'Reset available';

    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;

    return `${minutes}m ${seconds}s`;
  }, [rateLimitInfo]);

  const getUsagePercentage = useCallback(() => {
    if (!rateLimitInfo || rateLimitInfo.limit <= 0) return 0;
    const pct =
      ((rateLimitInfo.limit - rateLimitInfo.remaining) / rateLimitInfo.limit) *
      100;
    return Math.min(100, Math.max(0, pct));
  }, [rateLimitInfo]);

  return {
    rateLimitInfo,
    isVisible,
    getRemainingTimeText,
    getUsagePercentage,
    updateRateLimit,
  };
};
