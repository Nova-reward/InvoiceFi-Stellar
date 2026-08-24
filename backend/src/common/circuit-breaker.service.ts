import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  successThresholdHalfOpen: number;
  timeWindowMs: number;
  stalenessFailureThreshold: number;
}

interface CircuitBreakerInstance {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
  consecutiveStalenessFailures: number;
}

@Injectable()
export class CircuitBreakerService {
  private logger = new Logger(CircuitBreakerService.name);
  private circuits: Map<string, CircuitBreakerInstance> = new Map();
  private config: CircuitBreakerConfig;

  constructor(private configService: ConfigService) {
    this.config = {
      failureThreshold: Number(this.configService.get('CIRCUIT_BREAKER_FAILURE_THRESHOLD') || '5'),
      resetTimeoutMs: Number(this.configService.get('CIRCUIT_BREAKER_RESET_TIMEOUT_MS') || '60000'),
      successThresholdHalfOpen: Number(this.configService.get('CIRCUIT_BREAKER_SUCCESS_THRESHOLD') || '2'),
      timeWindowMs: Number(this.configService.get('CIRCUIT_BREAKER_TIME_WINDOW_MS') || '10000'),
      stalenessFailureThreshold: Number(this.configService.get('CIRCUIT_BREAKER_STALENESS_FAILURE_THRESHOLD') || '3'),
    };
  }

  private getOrCreateCircuit(name: string): CircuitBreakerInstance {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        consecutiveStalenessFailures: 0,
      });
    }
    return this.circuits.get(name)!;
  }

  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>,
    options?: { isStalenessError?: (error: unknown) => boolean },
  ): Promise<T> {
    const circuit = this.getOrCreateCircuit(name);

    if (circuit.state === CircuitState.OPEN) {
      const now = Date.now();
      if (circuit.nextAttemptTime && now >= circuit.nextAttemptTime) {
        circuit.state = CircuitState.HALF_OPEN;
        circuit.successes = 0;
        circuit.failures = 0;
        circuit.consecutiveStalenessFailures = 0;
        this.logger.log(`Circuit ${name} transitioned to HALF_OPEN`);
      } else {
        if (fallback) return fallback();
        throw new ServiceUnavailableException(`Circuit breaker ${name} is OPEN`);
      }
    }

    try {
      const result = await fn();

      if (circuit.state === CircuitState.HALF_OPEN) {
        circuit.successes++;
        if (circuit.successes >= this.config.successThresholdHalfOpen) {
          circuit.state = CircuitState.CLOSED;
          circuit.failures = 0;
          circuit.successes = 0;
          circuit.consecutiveStalenessFailures = 0;
          this.logger.log(`Circuit ${name} transitioned to CLOSED`);
        }
      } else if (circuit.state === CircuitState.CLOSED) {
        circuit.failures = 0;
      }

      // Reset staleness counter on success
      circuit.consecutiveStalenessFailures = 0;

      return result;
    } catch (error) {
      circuit.failures++;
      circuit.lastFailureTime = Date.now();

      // Track consecutive staleness errors
      const isStaleness = options?.isStalenessError?.(error) ?? false;
      if (isStaleness) {
        circuit.consecutiveStalenessFailures++;
        this.logger.warn(
          `Circuit ${name} detected staleness error (${circuit.consecutiveStalenessFailures}/${this.config.stalenessFailureThreshold})`,
        );
      } else {
        circuit.consecutiveStalenessFailures = 0;
      }

      if (circuit.state === CircuitState.HALF_OPEN) {
        circuit.state = CircuitState.OPEN;
        circuit.nextAttemptTime = Date.now() + this.config.resetTimeoutMs;
        this.logger.warn(`Circuit ${name} transitioned to OPEN (half-open failure)`);
      } else if (circuit.state === CircuitState.CLOSED) {
        // Trip on consecutive staleness failures (stricter than general failure threshold)
        if (
          isStaleness &&
          circuit.consecutiveStalenessFailures >= this.config.stalenessFailureThreshold
        ) {
          circuit.state = CircuitState.OPEN;
          circuit.nextAttemptTime = Date.now() + this.config.resetTimeoutMs;
          this.logger.warn(
            `Circuit ${name} transitioned to OPEN (${circuit.consecutiveStalenessFailures} consecutive staleness failures)`,
          );
        } else if (circuit.failures >= this.config.failureThreshold) {
          circuit.state = CircuitState.OPEN;
          circuit.nextAttemptTime = Date.now() + this.config.resetTimeoutMs;
          this.logger.warn(`Circuit ${name} transitioned to OPEN (${circuit.failures} failures)`);
        }
      }

      if (fallback) return fallback();
      throw error;
    }
  }

  getState(name: string): CircuitState {
    return this.getOrCreateCircuit(name).state;
  }

  reset(name: string): void {
    const circuit = this.getOrCreateCircuit(name);
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.successes = 0;
    circuit.consecutiveStalenessFailures = 0;
    delete circuit.nextAttemptTime;
    this.logger.log(`Circuit ${name} manually reset`);
  }
}
