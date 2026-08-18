import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { lifecycleStages, type ClientOnboardingItem } from "@/lib/company-data";

/**
 * Where this company sits in the twelve-stage lifecycle, at the top of the
 * record.
 *
 * The record already held every part of the lifecycle — the current-stage
 * workspace, the stage-move history and the all-stage checklist — but the
 * first thing on screen was the address form, and the stage itself was one
 * grey word in the subtitle. On a record roughly eight thousand pixels tall
 * that meant scrolling five screens to answer "where is this deal?". This
 * strip answers it above the fold and links straight down to the work.
 *
 * Presentational only: it reads the stage and the checklist rows the page has
 * already fetched and writes nothing. Stage changes still happen where they
 * always did — the profile form, or an event advancing the deal by itself.
 */

type ClientLifecycleStepperProps = {
  currentStage: string | null;
  items: ClientOnboardingItem[];
};

/** Anchor on the current-step workspace, so the strip can jump to the work. */
export const currentStepAnchorId = "current-step";

export function ClientLifecycleStepper({ currentStage, items }: ClientLifecycleStepperProps) {
  const currentIndex = lifecycleStages.indexOf(currentStage as (typeof lifecycleStages)[number]);

  // A stage the codebase does not know about. It should not be reachable —
  // the profile form is a fixed select — but a value written by another path
  // must be visible here rather than silently rendered as "not started yet".
  const offPlan = currentIndex === -1;

  const steps = lifecycleStages.map((stage, index) => {
    const stageItems = items.filter((item) => item.lifecycle_stage === stage);
    const done = stageItems.filter((item) => item.completed).length;
    const state = offPlan ? "upcoming" : index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";

    return { stage, index, done, total: stageItems.length, state };
  });

  const completedStages = steps.filter((step) => step.state === "done").length;

  return (
    <section aria-label="Client lifecycle" className="lifecycle-stepper">
      <div className="lifecycle-stepper-head">
        <div>
          <div className="eyebrow">Client Lifecycle</div>
          <h2>{offPlan ? (currentStage || "No stage set") : currentStage}</h2>
        </div>
        <div className="lifecycle-stepper-meta">
          <span className="badge">
            {offPlan ? "Off-plan stage" : `Stage ${currentIndex + 1} of ${lifecycleStages.length}`}
          </span>
          <Link className="button button-light" href={`#${currentStepAnchorId}`}>
            Go to current step
          </Link>
        </div>
      </div>

      {offPlan ? (
        <p className="lifecycle-stepper-warning" role="status">
          <AlertTriangle aria-hidden size={15} />
          <span>
            This company is on <strong>{currentStage || "no stage"}</strong>, which is not one of the twelve lifecycle
            stages. It will not appear in a column on the Lifecycle Board. Set a stage on the company profile below.
          </span>
        </p>
      ) : null}

      <ol className="lifecycle-stepper-track">
        {steps.map((step) => (
          <li className={`lifecycle-step is-${step.state}`} key={step.stage}>
            <span aria-hidden className="lifecycle-step-marker">
              {step.state === "done" ? <Check size={13} /> : step.index + 1}
            </span>
            <span className="lifecycle-step-body">
              <span className="lifecycle-step-name">{step.stage}</span>
              <span className="lifecycle-step-count">
                {step.total === 0 ? "No checklist" : `${step.done}/${step.total} checklist`}
              </span>
            </span>
            {step.state === "current" ? <span className="lifecycle-step-sr">Current stage</span> : null}
          </li>
        ))}
      </ol>

      <p className="lifecycle-stepper-foot">
        {offPlan
          ? "No stages counted as complete while the company sits off the plan."
          : `${completedStages} of ${lifecycleStages.length} stages behind this company.`}
      </p>
    </section>
  );
}
