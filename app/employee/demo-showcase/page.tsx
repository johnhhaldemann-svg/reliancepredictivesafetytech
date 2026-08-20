"use client";

import { useState } from "react";
import {
  AppWindow,
  Armchair,
  BarChart3,
  BriefcaseBusiness,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  Gauge,
  GraduationCap,
  HardHat,
  MonitorPlay,
  Scale,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { DemoDeckViewer } from "@/components/DemoDeckViewer";
import { InteractiveDemoViewer } from "@/components/InteractiveDemoViewer";
import { SalesMeetingInvitePanel } from "@/components/SalesMeetingInvitePanel";
import { interactiveDemos } from "@/lib/demos/interactive-demos";

const constructionLinks = [
  {
    label: "Guided Demo",
    href: "/demos/safepredict-interactive-demo.html",
    description: "Public click-through tour — opens with no login required.",
    icon: MonitorPlay,
  },
  {
    label: "Command Center",
    href: "/demos/safepredict-interactive-demo.html#dashboard",
    description: "Portfolio safety posture across every active site.",
    icon: Gauge,
  },
  {
    label: "Jobsites",
    href: "/demos/safepredict-interactive-demo.html#sites",
    description: "Site-by-site workspaces, phases, and live activity.",
    icon: HardHat,
  },
  {
    label: "Contractors",
    href: "/demos/safepredict-interactive-demo.html#contractors",
    description: "Live subcontractor risk scoring, prequal, and approvals.",
    icon: BriefcaseBusiness,
  },
  {
    label: "Crew Competency",
    href: "/demos/safepredict-interactive-demo.html#crew",
    description: "Crew competency matching and qualification gating.",
    icon: UserRound,
  },
  {
    label: "Observations",
    href: "/demos/safepredict-interactive-demo.html#obs",
    description: "Field observations and leading-indicator capture.",
    icon: FileCheck2,
  },
  {
    label: "Incidents",
    href: "/demos/safepredict-interactive-demo.html#incidents",
    description: "Incident reporting with OSHA 1904 recordability.",
    icon: ShieldAlert,
  },
  {
    label: "OSHA Recordkeeping",
    href: "/demos/safepredict-interactive-demo.html#osha",
    description: "OSHA 300 / 300A log and TRIR, computed and audit-ready.",
    icon: Scale,
  },
  {
    label: "Permits",
    href: "/demos/safepredict-interactive-demo.html#permits",
    description: "Permit issue, approval, and expiry tracking.",
    icon: ClipboardCheck,
  },
  {
    label: "Training",
    href: "/demos/safepredict-interactive-demo.html#training",
    description: "Training records, expirations, and competency gaps.",
    icon: GraduationCap,
  },
  {
    label: "Trends",
    href: "/demos/safepredict-interactive-demo.html#trends",
    description: "Predictive trends and leading risk indicators.",
    icon: BarChart3,
  },
  {
    label: "Gus AI Analyst",
    href: "/demos/safepredict-interactive-demo.html#gus",
    description: "AI safety analyst answering questions against live site data.",
    icon: Sparkles,
  },
];

const macoLinks = [
  {
    label: "Dashboard",
    href: "https://safetyiq-platform.vercel.app/dashboard",
    description: "Command center overview of safety status, alerts, and tasks.",
    icon: Gauge,
  },
  {
    label: "Legal Register",
    href: "https://safetyiq-platform.vercel.app/legal",
    description: "Applicable legal and standards obligations with evidence.",
    icon: Scale,
  },
  {
    label: "Risk Intelligence",
    href: "https://safetyiq-platform.vercel.app/risk",
    description: "Predictive risk trends, heat maps, and recommended actions.",
    icon: ShieldAlert,
  },
  {
    label: "Corrective Actions / CAPA",
    href: "https://safetyiq-platform.vercel.app/capa",
    description: "Assign, track, verify, and close findings to resolution.",
    icon: ClipboardCheck,
  },
  {
    label: "Training & Competency",
    href: "https://safetyiq-platform.vercel.app/training",
    description: "Role and hazard-based training status, completions, and gaps.",
    icon: GraduationCap,
  },
  {
    label: "Chemical Management",
    href: "https://safetyiq-platform.vercel.app/chemicals",
    description: "Chemical inventory, SDS currency, and hazard class tracking.",
    icon: FlaskConical,
  },
  {
    label: "Waste Management",
    href: "https://safetyiq-platform.vercel.app/waste",
    description: "Waste profiles, accumulation, manifests, and disposal records.",
    icon: Trash2,
  },
  {
    label: "Ergonomics",
    href: "https://safetyiq-platform.vercel.app/ergonomics",
    description: "Ergonomic assessments and musculoskeletal risk reduction.",
    icon: Armchair,
  },
  {
    label: "Reports & Analytics",
    href: "https://safetyiq-platform.vercel.app/reports",
    description: "Executive, compliance, risk, and audit reporting.",
    icon: BarChart3,
  },
];

const interactiveDemoIcons: Record<string, typeof Gauge> = {
  safepredict: Gauge,
  aeris: AppWindow,
};

type DemoTab = "construction" | "maco" | "interactive" | "scheduler";

export default function DemoShowcasePage() {
  const [activeTab, setActiveTab] = useState<DemoTab>("construction");
  const [activeInteractiveKey, setActiveInteractiveKey] = useState<string>(interactiveDemos[0].key);

  const activeInteractiveDemo =
    interactiveDemos.find((demo) => demo.key === activeInteractiveKey) ?? interactiveDemos[0];

  const isDeckTab = activeTab === "construction" || activeTab === "maco";
  const isConstruction = activeTab === "construction";

  const links = isConstruction ? constructionLinks : macoLinks;
  const deckTitle = isConstruction ? "SafePredict demo deck" : "MACO demo deck";
  const deckPdfPath = isConstruction ? "/demo-deck.pdf" : "/maco-demo-deck.pdf";
  const slidePath = isConstruction ? "/demo-deck-slides" : "/maco-demo-deck-slides";
  const totalPages = isConstruction ? 16 : 17;
  const platformLabel = isConstruction ? "SafePredict demo links" : "MACO demo links";

  return (
    <div className="demo-showcase">
      <div className="portal-topline command-hero">
        <div>
          <div className="eyebrow">Demo Showcase</div>
          <h1>Presentation and platform links</h1>
          <p>Use this page during sales calls to keep the deck and live platform pages in one protected workspace.</p>
        </div>
        {isDeckTab && (
          <a className="button button-light" href={deckPdfPath} target="_blank" rel="noreferrer">
            Open Deck <ExternalLink size={17} />
          </a>
        )}
      </div>

      <div className="demo-showcase-tabs" role="tablist" aria-label="Demo section">
        <button
          role="tab"
          aria-selected={activeTab === "construction"}
          className={`demo-tab${activeTab === "construction" ? " demo-tab-active" : ""}`}
          onClick={() => setActiveTab("construction")}
          type="button"
        >
          Construction
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "maco"}
          className={`demo-tab${activeTab === "maco" ? " demo-tab-active" : ""}`}
          onClick={() => setActiveTab("maco")}
          type="button"
        >
          MACO
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "interactive"}
          className={`demo-tab${activeTab === "interactive" ? " demo-tab-active" : ""}`}
          onClick={() => setActiveTab("interactive")}
          type="button"
        >
          Interactive
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "scheduler"}
          className={`demo-tab${activeTab === "scheduler" ? " demo-tab-active" : ""}`}
          onClick={() => setActiveTab("scheduler")}
          type="button"
        >
          Scheduler
        </button>
      </div>

      {isDeckTab && (
        <div className="demo-showcase-layout">
          <section className="command-panel demo-presentation-panel" aria-labelledby="demo-presentation-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Presentation</span>
                <h2 id="demo-presentation-title">{deckTitle}</h2>
              </div>
              <span className="badge">{deckPdfPath}</span>
            </div>
            <DemoDeckViewer
              key={activeTab}
              slidePath={slidePath}
              totalPages={totalPages}
              altPrefix={deckTitle}
            />
          </section>

          <section className="command-panel" aria-labelledby="platform-links-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Platform</span>
                <h2 id="platform-links-title">{platformLabel}</h2>
              </div>
              <span className="badge">{links.length} links</span>
            </div>

            <div className="demo-link-grid">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <a className="demo-link-card" href={link.href} target="_blank" rel="noreferrer" key={link.href}>
                    <span className="demo-link-icon">
                      <Icon size={19} />
                    </span>
                    <span className="demo-link-meta">
                      <strong>{link.label}</strong>
                      <span>{link.description}</span>
                    </span>
                    <ExternalLink size={16} />
                  </a>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {activeTab === "interactive" && (
        <div className="demo-showcase-layout">
          <section className="command-panel demo-presentation-panel" aria-labelledby="interactive-demo-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Interactive</span>
                <h2 id="interactive-demo-title">{activeInteractiveDemo.label}</h2>
              </div>
              <span className="badge">{activeInteractiveDemo.href}</span>
            </div>
            <InteractiveDemoViewer src={activeInteractiveDemo.href} title={activeInteractiveDemo.label} />
          </section>

          <section className="command-panel" aria-labelledby="interactive-demo-links-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Demos</span>
                <h2 id="interactive-demo-links-title">Clickable product demos</h2>
              </div>
              <span className="badge">{interactiveDemos.length} demos</span>
            </div>

            <div className="demo-link-grid">
              {interactiveDemos.map((demo) => {
                const Icon = interactiveDemoIcons[demo.key] ?? MonitorPlay;
                const isActive = demo.key === activeInteractiveDemo.key;
                return (
                  <button
                    className={`demo-link-card demo-link-button${isActive ? " demo-link-card-active" : ""}`}
                    onClick={() => setActiveInteractiveKey(demo.key)}
                    type="button"
                    aria-pressed={isActive}
                    key={demo.key}
                  >
                    <span className="demo-link-icon">
                      <Icon size={19} />
                    </span>
                    <span className="demo-link-meta">
                      <strong>{demo.label}</strong>
                      <span>{demo.description}</span>
                    </span>
                    <MonitorPlay size={16} />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {activeTab === "scheduler" && (
        <div className="demo-scheduler-tab">
          <SalesMeetingInvitePanel defaultTitle="SafetyDocs360 demo presentation" />
        </div>
      )}
    </div>
  );
}
