import toast from 'react-hot-toast';
import { PhoneNumberData } from '../types';

export class NumberProcessingUtils {
  /**
   * Content-derived key for a batch of numbers. Keying on length + first
   * number alone collides for different files that share those two values, so
   * we fold every cleaned value into a cheap deterministic (FNV-1a) hash.
   */
  static generateNumbersKey(numbers: PhoneNumberData[]): string {
    let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
    for (const n of numbers) {
      const value = n.cleaned || n.original || '';
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      hash ^= 0x2c; // ',' separator so ['ab','c'] != ['a','bc']
      hash = Math.imul(hash, 0x01000193);
    }
    return `${numbers.length}-${(hash >>> 0).toString(36)}`;
  }

  static filterDuplicates(
    existingNumbers: PhoneNumberData[],
    newNumbers: PhoneNumberData[]
  ): { uniqueNumbers: PhoneNumberData[]; duplicateCount: number } {
    // Seed with existing numbers, then add as we go so the incoming batch is
    // also deduplicated against itself.
    const seen = new Set(existingNumbers.map((n) => n.cleaned));
    const uniqueNumbers: PhoneNumberData[] = [];
    for (const newNum of newNumbers) {
      if (seen.has(newNum.cleaned)) continue;
      seen.add(newNum.cleaned);
      uniqueNumbers.push(newNum);
    }
    const duplicateCount = newNumbers.length - uniqueNumbers.length;

    return { uniqueNumbers, duplicateCount };
  }

  static showDuplicateToast(
    uniqueCount: number,
    duplicateCount: number,
    totalCount: number
  ): void {
    if (duplicateCount > 0) {
      toast.success(
        `Added ${uniqueCount} new numbers, skipped ${duplicateCount} duplicates (Total: ${totalCount})`
      );
    } else {
      toast.success(`Added ${uniqueCount} more numbers (Total: ${totalCount})`);
    }
  }

  static preventDuplicateToasts(
    loadedFileIds: React.MutableRefObject<Set<string>>,
    numbersKey: string,
    onFirstLoad: () => void,
    onSubsequentLoad: () => void
  ): void {
    if (!loadedFileIds.current.has(numbersKey)) {
      onFirstLoad();
      loadedFileIds.current.add(numbersKey);

      // Clear the loaded file ID after a short delay to allow future loads
      setTimeout(() => {
        loadedFileIds.current.delete(numbersKey);
      }, 2000);
    } else {
      onSubsequentLoad();
    }
  }
}
