import { cpSync } from "node:fs"

for (const file of ["index.html", "style.css"]) cpSync(`src/ui/${file}`, `out/ui/${file}`)
cpSync("node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", "out/ui/fonts/Geist-Variable.woff2")
cpSync("node_modules/geist/LICENSE.txt", "out/ui/fonts/Geist-LICENSE.txt")
