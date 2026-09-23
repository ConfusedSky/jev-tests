// mutool run highlight.js copy.pdf PAGE QUADS: adds a highlight annotation
// over QUADS (a JSON array of [ulx, uly, urx, ury, llx, lly, lrx, lry]) on
// PAGE of copy.pdf, saved in place. Positions are the ones stext reports.
var doc = Document.openDocument(scriptArgs[0]);
var page = doc.loadPage(Number(scriptArgs[1]) - 1);
var annot = page.createAnnotation("Highlight");
annot.setQuadPoints(JSON.parse(scriptArgs[2]));
annot.setColor([1, 0.9, 0.2]);
annot.update();
doc.save(scriptArgs[0], "incremental");
