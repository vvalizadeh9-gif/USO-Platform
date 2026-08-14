import { AnimatePresence, motion } from 'framer-motion'
import { ClipboardList, ListChecks, History } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHead } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import HcBasketTab from './healthcheck/HcBasketTab'
import HcResultsTab from './healthcheck/HcResultsTab'
import HcHistoryTab from './healthcheck/HcHistoryTab'

export default function HealthCheck() {
  const { user } = useAuth()
  const canSeeHistory = ['Admin', 'PM'].includes(user?.role?.name)
  const tabs = [
    { key: 'basket', label: 'HC Basket', icon: ClipboardList },
    { key: 'results', label: 'HC Results', icon: ListChecks },
    ...(canSeeHistory ? [{ key: 'history', label: 'HC History', icon: History }] : []),
  ]
  // Deep-linked from Action Center: ?tab=results&task=<hc-task-id>
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || 'basket')
  const highlightTaskId = searchParams.get('task')

  return (
    <>
      <PageHead
        eyebrow="Health Check"
        title="Health Check"
        subtitle="Assign on-air sites for health check and review Ready / Not Ready outcomes."
      />

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="row" style={{ gap: 8 }}><t.icon size={15} /> {t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'basket' && <HcBasketTab />}
          {tab === 'results' && <HcResultsTab highlightTaskId={highlightTaskId} />}
          {tab === 'history' && <HcHistoryTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
