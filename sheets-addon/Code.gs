/**
 * Lattice117 Schedule Check — Google Sheets add-on, server half.
 *
 * This file is the ONLY part that touches the spreadsheet. It does three
 * things and nothing else: open the sidebar, hand it a grid of strings, and
 * colour rows the sidebar asks it to colour.
 *
 * No UrlFetchApp. No DriveApp. No PropertiesService. The add-on is scoped to
 * `spreadsheets.currentonly`, which cannot reach any other file and cannot
 * make a network request, and the absence of those services here is what makes
 * that scope honest rather than merely declared.
 */

var SIDEBAR_TITLE = 'Lattice117 Schedule Check';
var HIGHLIGHT = '#4c1d24';   // readable against the sheet, and clearly deliberate

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Lattice117')
    .addItem('Schedule check', 'showSidebar')
    .addToUi();
}

/** Required when the add-on is installed rather than bound to one sheet. */
function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle(SIDEBAR_TITLE)
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Returns the user's selection as a grid of plain strings.
 *
 * getDisplayValues(), never getValues(). Three reasons, and the first one is
 * fatal rather than cosmetic:
 *
 *   1. getValues() returns a Date object for any time- or date-formatted cell,
 *      and Apps Script cannot serialise a Date across the sidebar boundary -
 *      it arrives as null or throws. A rota is mostly time-formatted cells, so
 *      the rota mode would fail on exactly the sheets it is built for.
 *   2. Display values are the strings the user can actually see, so "06:00"
 *      parses here the same way it parses from a CSV, and every surface shares
 *      one parser rather than each growing a host-specific one.
 *   3. It sidesteps the spreadsheet's own timezone entirely. A Date carries
 *      one; "06:00" does not, and a rota is wall-clock time by definition.
 *
 * Falls back to the whole data range when the user has not selected anything,
 * which is what someone who just opened the sidebar expects to happen.
 */
function readSelection() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var range = sheet.getActiveRange();
  if (!range || range.getNumRows() < 2) range = sheet.getDataRange();
  return range.getDisplayValues();
}

/**
 * Colours the rows the sidebar identified, so the result lands where the
 * planner is already looking rather than only in the pane.
 *
 * Row numbers are 1-based and sheet-absolute, exactly as the sidebar reports
 * them in its own output, so what the pane says and what the sheet shows
 * cannot disagree.
 */
function highlightRows(rows) {
  if (!rows || !rows.length) return;
  var sheet = SpreadsheetApp.getActiveSheet();
  var width = sheet.getLastColumn();
  for (var i = 0; i < rows.length; i++) {
    var r = Number(rows[i]);
    if (r >= 1 && r <= sheet.getLastRow()) {
      sheet.getRange(r, 1, 1, width).setBackground(HIGHLIGHT);
    }
  }
}

/** Clears backgrounds across the data range. */
function clearHighlighting() {
  var sheet = SpreadsheetApp.getActiveSheet();
  sheet.getDataRange().setBackground(null);
}
