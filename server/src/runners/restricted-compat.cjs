// Loaded in the tutor's private checks only, beside no-network.cjs. Pyodide
// (Python) and php-wasm (PHP) are built with an Emscripten version whose
// startup reads file-flag numbers (O_APPEND, O_CREAT, …) through the old
// process.binding("constants"). Node's permission system refuses
// process.binding, so both stopped before running anything. The same numbers
// are public as fs.constants; that one request is answered from there, and
// every other process.binding call still goes to Node and is still refused.
const fs = require("fs");
const nodeBinding = process.binding;
process.binding = function binding(name) {
  if (name === "constants") return { fs: fs.constants };
  return nodeBinding.call(process, name);
};
