import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import type { Construct } from 'constructs';

export const BUDGET_ALERTS_USD = [10, 30];

/** Monthly cost budget that emails `alertEmail` when actual spend passes each of BUDGET_ALERTS_USD. */
export function createBudget(scope: Construct, alertEmail: string): CfnBudget {
  return new CfnBudget(scope, 'Budget', {
    budget: {
      budgetName: 'supplier-line-monthly',
      budgetType: 'COST',
      timeUnit: 'MONTHLY',
      budgetLimit: { amount: Math.max(...BUDGET_ALERTS_USD), unit: 'USD' },
    },
    notificationsWithSubscribers: BUDGET_ALERTS_USD.map((threshold) => ({
      notification: {
        notificationType: 'ACTUAL',
        comparisonOperator: 'GREATER_THAN',
        threshold,
        thresholdType: 'ABSOLUTE_VALUE',
      },
      subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
    })),
  });
}
