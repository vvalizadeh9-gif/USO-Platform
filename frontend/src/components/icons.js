// The UEP icon set: IBM Carbon (Apache 2.0), bundled from node_modules, so no
// icon is fetched at run time. No other pack is mixed in on UEP-foundation
// pages. Each icon has Carbon's 16px glyph and its 20px glyph; the Icon
// component picks the one drawn for the size asked for.
import close16 from '@carbon/icons/es/close/16.js'
import close20 from '@carbon/icons/es/close/20.js'
import download16 from '@carbon/icons/es/download/16.js'
import download20 from '@carbon/icons/es/download/20.js'
import undo16 from '@carbon/icons/es/undo/16.js'
import undo20 from '@carbon/icons/es/undo/20.js'
import document16 from '@carbon/icons/es/document/16.js'
import document20 from '@carbon/icons/es/document/20.js'
import recentlyViewed16 from '@carbon/icons/es/recently-viewed/16.js'
import recentlyViewed20 from '@carbon/icons/es/recently-viewed/20.js'
import attachment16 from '@carbon/icons/es/attachment/16.js'
import attachment20 from '@carbon/icons/es/attachment/20.js'
import checkmarkFilled16 from '@carbon/icons/es/checkmark--filled/16.js'
import checkmarkFilled20 from '@carbon/icons/es/checkmark--filled/20.js'
import arrowLeft16 from '@carbon/icons/es/arrow--left/16.js'
import arrowLeft20 from '@carbon/icons/es/arrow--left/20.js'
import arrowRight16 from '@carbon/icons/es/arrow--right/16.js'
import arrowRight20 from '@carbon/icons/es/arrow--right/20.js'
import checkmark16 from '@carbon/icons/es/checkmark/16.js'
import checkmark20 from '@carbon/icons/es/checkmark/20.js'
import directionFork16 from '@carbon/icons/es/direction--fork/16.js'
import directionFork20 from '@carbon/icons/es/direction--fork/20.js'
import time16 from '@carbon/icons/es/time/16.js'
import time20 from '@carbon/icons/es/time/20.js'
import tools16 from '@carbon/icons/es/tools/16.js'
import tools20 from '@carbon/icons/es/tools/20.js'
import calendar16 from '@carbon/icons/es/calendar/16.js'
import calendar20 from '@carbon/icons/es/calendar/20.js'
import cellTower16 from '@carbon/icons/es/cell-tower/16.js'
import cellTower20 from '@carbon/icons/es/cell-tower/20.js'
import certificateCheck16 from '@carbon/icons/es/certificate--check/16.js'
import certificateCheck20 from '@carbon/icons/es/certificate--check/20.js'
import chartColumn16 from '@carbon/icons/es/chart--column/16.js'
import chartColumn20 from '@carbon/icons/es/chart--column/20.js'
import chevronDown16 from '@carbon/icons/es/chevron--down/16.js'
import chevronDown20 from '@carbon/icons/es/chevron--down/20.js'
import chevronRight16 from '@carbon/icons/es/chevron--right/16.js'
import chevronRight20 from '@carbon/icons/es/chevron--right/20.js'
import dataBase16 from '@carbon/icons/es/data--base/16.js'
import dataBase20 from '@carbon/icons/es/data--base/20.js'
import errorFilled16 from '@carbon/icons/es/error--filled/16.js'
import errorFilled20 from '@carbon/icons/es/error--filled/20.js'
import home16 from '@carbon/icons/es/home/16.js'
import home20 from '@carbon/icons/es/home/20.js'
import logout16 from '@carbon/icons/es/logout/16.js'
import logout20 from '@carbon/icons/es/logout/20.js'
import login16 from '@carbon/icons/es/login/16.js'
import login20 from '@carbon/icons/es/login/20.js'
import notification16 from '@carbon/icons/es/notification/16.js'
import notification20 from '@carbon/icons/es/notification/20.js'
import password16 from '@carbon/icons/es/password/16.js'
import password20 from '@carbon/icons/es/password/20.js'
import renew16 from '@carbon/icons/es/renew/16.js'
import renew20 from '@carbon/icons/es/renew/20.js'
import search16 from '@carbon/icons/es/search/16.js'
import search20 from '@carbon/icons/es/search/20.js'
import settings16 from '@carbon/icons/es/settings/16.js'
import settings20 from '@carbon/icons/es/settings/20.js'
import switcher16 from '@carbon/icons/es/switcher/16.js'
import switcher20 from '@carbon/icons/es/switcher/20.js'
import task16 from '@carbon/icons/es/task/16.js'
import task20 from '@carbon/icons/es/task/20.js'
import user16 from '@carbon/icons/es/user/16.js'
import user20 from '@carbon/icons/es/user/20.js'
import view16 from '@carbon/icons/es/view/16.js'
import view20 from '@carbon/icons/es/view/20.js'
import viewOff16 from '@carbon/icons/es/view--off/16.js'
import viewOff20 from '@carbon/icons/es/view--off/20.js'
import warningAlt16 from '@carbon/icons/es/warning--alt/16.js'
import warningAlt20 from '@carbon/icons/es/warning--alt/20.js'
import flag16 from '@carbon/icons/es/flag/16.js'
import flag20 from '@carbon/icons/es/flag/20.js'
import checkmarkOutline16 from '@carbon/icons/es/checkmark--outline/16.js'
import checkmarkOutline20 from '@carbon/icons/es/checkmark--outline/20.js'
import settingsAdjust16 from '@carbon/icons/es/settings--adjust/16.js'
import settingsAdjust20 from '@carbon/icons/es/settings--adjust/20.js'

/**
 * @typedef {{ elem: string, attrs: Record<string, string | number>, content?: CarbonNode[] }} CarbonNode
 * @typedef {CarbonNode & { name: string, size: number }} CarbonGlyph
 */

/** Purpose → glyphs. The left column is the name pages use. */
export const ICONS = Object.freeze({
  home: { 16: home16, 20: home20 },
  task: { 16: task16, 20: task20 },
  'cell-tower': { 16: cellTower16, 20: cellTower20 },
  'certificate--check': { 16: certificateCheck16, 20: certificateCheck20 },
  calendar: { 16: calendar16, 20: calendar20 },
  'chart--column': { 16: chartColumn16, 20: chartColumn20 },
  'data--base': { 16: dataBase16, 20: dataBase20 },
  settings: { 16: settings16, 20: settings20 },
  switcher: { 16: switcher16, 20: switcher20 },
  search: { 16: search16, 20: search20 },
  notification: { 16: notification16, 20: notification20 },
  'chevron--down': { 16: chevronDown16, 20: chevronDown20 },
  'chevron--right': { 16: chevronRight16, 20: chevronRight20 },
  'arrow--left': { 16: arrowLeft16, 20: arrowLeft20 },
  user: { 16: user16, 20: user20 },
  password: { 16: password16, 20: password20 },
  login: { 16: login16, 20: login20 },
  logout: { 16: logout16, 20: logout20 },
  view: { 16: view16, 20: view20 },
  'view--off': { 16: viewOff16, 20: viewOff20 },
  renew: { 16: renew16, 20: renew20 },
  'warning--alt': { 16: warningAlt16, 20: warningAlt20 },
  'error--filled': { 16: errorFilled16, 20: errorFilled20 },
  'arrow--right': { 16: arrowRight16, 20: arrowRight20 },
  'checkmark': { 16: checkmark16, 20: checkmark20 },
  'direction--fork': { 16: directionFork16, 20: directionFork20 },
  'time': { 16: time16, 20: time20 },
  'tools': { 16: tools16, 20: tools20 },
  'close': { 16: close16, 20: close20 },
  'download': { 16: download16, 20: download20 },
  'undo': { 16: undo16, 20: undo20 },
  'document': { 16: document16, 20: document20 },
  'recently-viewed': { 16: recentlyViewed16, 20: recentlyViewed20 },
  'attachment': { 16: attachment16, 20: attachment20 },
  'checkmark--filled': { 16: checkmarkFilled16, 20: checkmarkFilled20 },
  'flag': { 16: flag16, 20: flag20 },
  'checkmark--outline': { 16: checkmarkOutline16, 20: checkmarkOutline20 },
  'settings--adjust': { 16: settingsAdjust16, 20: settingsAdjust20 },
})

/** @typedef {keyof typeof ICONS} IconName */

/**
 * The glyph drawn for `size`: Carbon's 16px one up to 16px, its 20px one above.
 * @param {IconName} name
 * @param {number} size
 * @returns {CarbonGlyph}
 */
export function glyphFor(name, size) {
  const glyphs = ICONS[name]
  if (!glyphs) throw new Error(`Unknown icon "${name}"`)
  return size <= 16 ? glyphs[16] : glyphs[20]
}
