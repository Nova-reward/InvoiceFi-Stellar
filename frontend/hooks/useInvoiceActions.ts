import { useCallback, useState } from 'react'
import { useNetworkStatus } from './useNetworkStatus'

export interface InvoiceAction {
  id: string
  type: 'fund' | 'repay' | 'cancel'
  status: 'pending' | 'confirmed'
  timestamp: number
}

export function useInvoiceActions() {
  const [actions, setActions] = useState<Map<string, InvoiceAction>>(new Map())
  const { isOnline } = useNetworkStatus()

  const recordAction = useCallback(
    (invoiceId: string, type: InvoiceAction['type']) => {
      const actionId = `${type}-${invoiceId}-${Date.now()}`
      const action: InvoiceAction = {
        id: actionId,
        type,
        status: 'pending',
        timestamp: Date.now(),
      }

      setActions((prev) => new Map(prev).set(actionId, action))
      return actionId
    },
    []
  )

  const confirmAction = useCallback((actionId: string) => {
    setActions((prev) => {
      const newMap = new Map(prev)
      const action = newMap.get(actionId)
      if (action) {
        action.status = 'confirmed'
      }
      return newMap
    })
  }, [])

  const removeAction = useCallback((actionId: string) => {
    setActions((prev) => {
      const newMap = new Map(prev)
      newMap.delete(actionId)
      return newMap
    })
  }, [])

  const getPendingActions = useCallback(() => {
    return Array.from(actions.values()).filter((a) => a.status === 'pending')
  }, [actions])

  return {
    actions,
    recordAction,
    confirmAction,
    removeAction,
    getPendingActions,
    isOnline,
  }
}
