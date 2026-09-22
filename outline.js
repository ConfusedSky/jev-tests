var doc = Document.openDocument(scriptArgs[0]);
var entries = [];
function flatten(items, prefix, depth) {
  items.forEach(function (it) {
    var path = prefix + it.title;
    entries.push({ path: path, depth: depth, start: it.uri ? doc.resolveLink(it.uri) + 1 : null });
    if (it.down) flatten(it.down, path + " > ", depth + 1);
  });
}
flatten(doc.loadOutline() || [], "", 0);

// Destinations carry no y position, so a section is assumed to end the page
// before the next same-or-higher entry starts, stretched to cover its children.
entries.forEach(function (e, i) {
  if (e.start === null) return print(e.path + "\tnull\tnull");
  var end = e.start;
  for (var j = i + 1; j < entries.length && entries[j].depth > e.depth; j++)
    if (entries[j].start !== null) end = Math.max(end, entries[j].start);
  var next = j < entries.length ? entries[j].start : null;
  end = Math.max(end, next !== null ? next - 1 : doc.countPages());
  print(e.path + "\t" + e.start + "\t" + end);
});
