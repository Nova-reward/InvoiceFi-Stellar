'use client'

import { ReactNode } from 'react'

export interface ConflictData {
  local: Record<string, any>
  server: Record<string, any>
  /**
   * When this conflict originated from a replayed queue item, this field
   * carries the queue item's ID so callers can route the resolution back to
   * `useOfflineQueue.resolveConflict()`.
   */
  queueItemId?: string
}

interface Props {
  conflict: ConflictData
  onResolve: (resolution: 'local' | 'server' | 'merge') => void
  title?: string
  description?: string
  /**
   * Pass `true` when the conflict was detected during an offline queue replay
   * so the UI can show context-appropriate messaging.
   */
  isReplayConflict?: boolean
  /**
   * Optional slot for a merge editor.  When provided, the "Merge Changes"
   * button becomes available and this node is rendered between the comparison
   * columns and the action buttons.
   */
  mergeEditor?: ReactNode
}

export function ConflictResolution({
  conflict,
  onResolve,
  title,
  description,
  isReplayConflict = false,
  mergeEditor,
}: Props) {
  const defaultTitle = isReplayConflict
    ? 'Offline Change Conflict'
    : 'Data Conflict Detected'

  const defaultDescription = isReplayConflict
    ? 'A change you made while offline conflicts with an update made on the server. Choose how to resolve this before your offline change can be applied.'
    : 'Your local changes conflict with the latest server data. Choose how to resolve this.'

  return (
    <div className="conflict-modal" role="dialog" aria-labelledby="conflict-title" aria-modal="true">
      <div className="conflict-content">
        <h2 id="conflict-title">{title ?? defaultTitle}</h2>
        <p>{description ?? defaultDescription}</p>

        {isReplayConflict && (
          <div
            className="conflict-replay-banner"
            role="status"
            aria-label="Replay conflict notice"
          >
            <span aria-hidden="true">⚠️</span>{' '}
            This change was queued while you were offline and is now being replayed.
          </div>
        )}

        <div className="conflict-comparison">
          <div className="conflict-column">
            <h3>
              {isReplayConflict ? 'Your Offline Change (Local)' : 'Your Changes (Local)'}
            </h3>
            <div className="conflict-data" aria-label="Local version">
              <pre>{JSON.stringify(conflict.local, null, 2)}</pre>
            </div>
          </div>

          <div className="conflict-column">
            <h3>Latest Data (Server)</h3>
            <div className="conflict-data" aria-label="Server version">
              <pre>{JSON.stringify(conflict.server, null, 2)}</pre>
            </div>
          </div>
        </div>

        {mergeEditor && (
          <div className="conflict-merge-editor" aria-label="Merge editor">
            {mergeEditor}
          </div>
        )}

        <div className="conflict-actions">
          <button
            className="conflict-btn conflict-btn-local"
            onClick={() => onResolve('local')}
            aria-label={
              isReplayConflict
                ? 'Apply your offline change'
                : 'Keep your local changes'
            }
          >
            {isReplayConflict ? 'Apply Offline Change' : 'Keep My Changes'}
          </button>
          <button
            className="conflict-btn conflict-btn-server"
            onClick={() => onResolve('server')}
            aria-label="Use latest server data and discard local change"
          >
            Use Latest Data
          </button>
          <button
            className="conflict-btn conflict-btn-merge"
            onClick={() => onResolve('merge')}
            aria-label="Merge both changes"
            disabled={!mergeEditor}
          >
            Merge Changes
          </button>
        </div>

        <p className="conflict-note">
          {isReplayConflict
            ? 'No data has been lost. Your offline change is still queued and will only be discarded if you choose "Use Latest Data".'
            : 'Note: This conflict was detected after reconnecting. No data has been lost, and you can review both versions above.'}
        </p>
      </div>
    </div>
  )
}
