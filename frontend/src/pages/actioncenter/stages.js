import { CalendarRange, HeartPulse, Landmark, Radio, ShieldCheck } from 'lucide-react'
import { isCategoryOwner } from '../../lib/roles'

// The board's columns, in lifecycle order, by the names the approved board
// gives them ("ICT", "CRA" -- the server's longer label is the column's
// accessible description). Colours are the stage tokens in
// app.css (--stage-<key>-chip / -tint / -ink / -line), the same palette as
// Performance -> Lifecycle Gaps; a column reads them through data-stage.
export const STAGES = {
  hc: { label: 'Health Check', icon: HeartPulse },
  dt: { label: 'Drive Test', icon: Radio },
  ict: { label: 'ICT', icon: ShieldCheck },
  cra: { label: 'CRA', icon: Landmark },
  plans: { label: 'Plans & Data', icon: CalendarRange },
}

// Which columns a role can ever have -- the registry's role sets, by stage
// (app/services/action_queues/registry.py). Used only to draw the loading
// state in the board's final shape; the board itself shows the stages the
// server returns.
const STAGES_BY_ROLE = {
  PM: ['hc', 'dt', 'ict', 'cra', 'plans'],
  Coordinator: ['hc', 'dt', 'ict', 'cra'],
  Contractor: ['hc', 'dt', 'ict', 'cra', 'plans'],
}

export function expectedStages(roleName) {
  if (isCategoryOwner(roleName)) return ['hc']
  return STAGES_BY_ROLE[roleName] || ['hc', 'dt', 'ict', 'cra']
}
