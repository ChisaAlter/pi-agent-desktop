import React, { useEffect, useState } from "react";

interface AnimatedCollapseProps {
  expanded: boolean;
  children: React.ReactNode;
  className?: string;
}

export function AnimatedCollapse({
  expanded,
  children,
  className = "",
}: AnimatedCollapseProps): React.JSX.Element | null {
  const [rendered, setRendered] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setRendered(true);
      return undefined;
    }

    const timeout = window.setTimeout(() => setRendered(false), 160);
    return () => window.clearTimeout(timeout);
  }, [expanded]);

  if (!rendered) return null;

  return (
    <div
      aria-hidden={!expanded}
      inert={!expanded}
      className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[var(--motion-panel)] ease-[var(--motion-ease)] motion-reduce:transition-none ${
        expanded
          ? "grid-rows-[1fr] translate-y-0 opacity-100"
          : "pointer-events-none grid-rows-[0fr] -translate-y-1 opacity-0"
      } ${className}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
