// mutool run sizes.js FILE [PAGE...]: prints "page<TAB>width<TAB>height" for
// each PAGE, or for every page, in the space stext reports positions in and
// mutool draws, so a box off stext scales onto a rendered page.
var doc = Document.openDocument(scriptArgs[0]);
var pages = scriptArgs.slice(1).map(Number);
if (pages.length === 0) for (var p = 1; p <= doc.countPages(); p++) pages.push(p);
pages.forEach(function (p) {
  var b = doc.loadPage(p - 1).getBounds();
  print(p + "\t" + (b[2] - b[0]) + "\t" + (b[3] - b[1]));
});
