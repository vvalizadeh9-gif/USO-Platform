import { shamsiMonthName } from '../../../lib/shamsi'
import { count } from '../format'
import { flowView } from './flowView'

/**
 * "View as table" for On air vs DT done: the same points the chart draws
 * (flowView), every month since the opening balance, newest first, so the
 * table and the plot can never disagree. The standard alternative to every
 * UEP chart -- colour is never the only way to read the figures.
 */
export default function FlowTable({ data }) {
  const { points, months } = flowView(data)
  const rows = months.map((m, j) => ({ ...m, ...points[j + 1] })).reverse()
  return (
    <div className="dt-flow-table-wrap">
      <table className="dt-flow-table">
        <caption className="dt-sr-only">On air vs DT done by month, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">On air</th>
            <th scope="col">DT done</th>
            <th scope="col">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.year}-${r.month}`}>
              <th scope="row" className="dt-farsi">
                {shamsiMonthName(r.month)} {r.year}
                {r.isOpen ? ' · so far' : ''}
              </th>
              <td className="tnum">{count(r.onAir)}</td>
              <td className="tnum">{count(r.dtDone)}</td>
              <td className="tnum">{count(r.gap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
