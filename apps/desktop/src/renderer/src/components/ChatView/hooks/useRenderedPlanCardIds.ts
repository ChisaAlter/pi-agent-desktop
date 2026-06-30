// Tracks which plan cards have already been rendered into a conversation,
// so the plan sync effect can de-dupe re-emissions of the same card.

import { usePlanStore } from "../../../stores/plan-store";

export function useRenderedPlanCardIds(): string[] {
  return usePlanStore((state) => state.renderedPlanCardIds);
}
