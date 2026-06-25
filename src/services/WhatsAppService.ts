import { WhatsAppChecker } from 'whatsapp-number-checker';
import { categoryOf } from '../shared/categorize';
import {
  AppSettings,
  BulkCheckOptions,
  BulkCheckProgress,
  PhoneNumberData,
  WhatsAppCheckResult,
} from '../types';

export class WhatsAppService {
  private checker: WhatsAppChecker;
  private isCancelled: boolean = false;

  constructor(settings: AppSettings) {
    this.checker = new WhatsAppChecker({
      apiKey: settings.apiKey,
      throwOnLimit: settings.throwOnLimit || false,
      timeout: settings.timeout || 15000,
      maxRetries: settings.maxRetries || 3,
      retryDelay: settings.retryDelay || 1000,
      baseURL: settings.baseURL || 'https://whatsapp-data1.p.rapidapi.com',
    });
  }

  async checkSingle(phoneNumber: string): Promise<WhatsAppCheckResult> {
    try {
      const result = await this.checker.checkNumber(phoneNumber);
      return {
        number: phoneNumber,
        data: result.data,
        error: result.error,
        rateLimitInfo: result.rateLimitInfo,
      } as WhatsAppCheckResult;
    } catch (error) {
      return {
        number: phoneNumber,
        data: null,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async checkBulk(
    phoneNumbers: PhoneNumberData[],
    options: BulkCheckOptions
  ): Promise<WhatsAppCheckResult[]> {
    const results: WhatsAppCheckResult[] = [];
    let completed = 0;
    let successful = 0;
    let failed = 0;
    let rateLimited = 0;

    this.isCancelled = false;

    try {
      // Prepare numbers for checking (only valid ones)
      const numbersToCheck = phoneNumbers
        .filter((num) => num.isValid && num.cleaned)
        .map((num) => num.cleaned);

      if (numbersToCheck.length === 0) {
        throw new Error('No valid numbers to check');
      }

      // Use the built-in bulk check with progress tracking
      await this.checker.checkBulk(numbersToCheck, {
        onProgress: (
          completedCount: number,
          totalCount: number,
          current: any
        ) => {
          if (this.isCancelled) {
            return;
          }

          completed = completedCount;

          // Count using the shared categorizer so live progress agrees with the
          // final session stats. Rate-limited / pending are intentionally not
          // counted as successful or failed.
          const category = categoryOf(current);
          if (category === 'active') {
            successful++;
          } else if (
            category === 'not_on_whatsapp' ||
            category === 'api_error'
          ) {
            failed++;
          }

          // Create progress object
          const progress: BulkCheckProgress = {
            completed,
            total: totalCount,
            percentage: Math.round((completed / totalCount) * 100),
            successful,
            failed,
            rateLimited,
            currentNumber: current.number,
            currentResult: {
              number: current.number,
              data: current.data,
              error: current.error,
              rateLimitInfo: current.rateLimitInfo,
            },
          };

          // Call progress callback
          if (options.onProgress) {
            options.onProgress(progress);
          }

          // Store result, stamping the check time once at creation so it
          // survives subsequent session saves.
          results.push({
            number: current.number,
            data: current.data,
            error: current.error,
            rateLimitInfo: current.rateLimitInfo,
            checkedAt: new Date().toISOString(),
          });
        },
        onRateLimit: (rateLimitInfo) => {
          rateLimited++;
          if (options.onRateLimit) {
            options.onRateLimit(rateLimitInfo);
          }
        },
        stopOnError: options.stopOnError || false,
        maxRetries: options.maxRetries,
      });

      return results;
    } catch (error) {
      // Swallow the error but keep partial results; persistence happens in the
      // `finally` block so a cancelled or failed run is never left dangling.
      console.error('Bulk check error:', error);
      return results;
    } finally {
      // Always persist what we have — including on cancellation — so the
      // session is never stuck at `running` on disk.
      if (options.onComplete) {
        await options.onComplete(results);
      }
    }
  }

  cancelCheck(): void {
    this.isCancelled = true;
    // Clear the queue to stop pending requests
    if (this.checker && typeof this.checker.clearQueue === 'function') {
      this.checker.clearQueue();
    }
  }

  getRateLimitInfo() {
    return this.checker.getRateLimitInfo();
  }

  getCurrentRateInterval(): number {
    return this.checker.getCurrentRateInterval();
  }

  getQueueLength(): number {
    return this.checker.getQueueLength();
  }
}
