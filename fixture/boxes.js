// mutool run boxes.js IN OUT MEDIABOX CROPBOX ROTATE: IN's first page with
// its boxes set, each "x0,y0,x1,y1" or "-" to leave it, turned by ROTATE.
var doc = Document.openDocument(scriptArgs[0]);
var page = doc.findPage(0);
var box = function (s) { return s.split(",").map(Number); };
if (scriptArgs[2] !== "-") page.put("MediaBox", box(scriptArgs[2]));
if (scriptArgs[3] !== "-") page.put("CropBox", box(scriptArgs[3]));
page.put("Rotate", Number(scriptArgs[4]));
doc.save(scriptArgs[1], "");
