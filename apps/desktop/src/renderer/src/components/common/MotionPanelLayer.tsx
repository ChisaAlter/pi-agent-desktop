import React, { useState } from "react";

interface MotionPanelLayerProps {
    active: boolean;
    panelId: string;
    children: React.ReactNode;
    enterOnMount?: boolean;
}

export function MotionPanelLayer({
    active,
    panelId,
    children,
    enterOnMount = false,
}: MotionPanelLayerProps): React.JSX.Element {
    const [playsMountEntrance] = useState(enterOnMount);

    return (
        <section
            className="pi-motion-panel-layer"
            data-testid={`motion-panel-${panelId}`}
            data-main-panel={panelId}
            data-active={active ? "true" : "false"}
            data-enter-on-mount={playsMountEntrance ? "true" : "false"}
            aria-hidden={!active}
            inert={active ? undefined : true}
        >
            {children}
        </section>
    );
}
