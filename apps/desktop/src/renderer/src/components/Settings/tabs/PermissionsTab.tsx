import React from 'react';
import { ToolPermissionsPanel } from '../../ToolPermissions/ToolPermissionsPanel';
import { useWorkspaceStore } from '../../../stores/workspace-store';
import { SectionTitle } from '../_shared';

export function PermissionsTab(): React.JSX.Element {
    const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());

    return (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-permissions" aria-labelledby="settings-tab-permissions">
            <SectionTitle
                title="权限"
                description="管理当前工作区的默认工具权限。会话内仍可在右侧上下文面板临时调整。"
            />
            <div className="mb-4 rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-3">
                <div className="text-xs text-[var(--mm-text-tertiary)]">当前工作区</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--mm-text-primary)]" title={currentWorkspace?.path}>
                    {currentWorkspace ? `${currentWorkspace.name} · ${currentWorkspace.path}` : '未选择工作区'}
                </div>
            </div>
            <ToolPermissionsPanel workspaceId={currentWorkspace?.id} />
        </div>
    );
}
