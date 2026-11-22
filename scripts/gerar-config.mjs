// Gera public/js/config.js no build do Netlify a partir das variáveis de ambiente.
// Só valores públicos: a URL do projeto e a chave anon (protegida pelas regras RLS do banco).
import { writeFileSync } from "node:fs"
const url = process.env.SUPABASE_URL || ""
const anon = process.env.SUPABASE_ANON_KEY || ""
if (!url || !anon) console.warn("⚠️  SUPABASE_URL / SUPABASE_ANON_KEY não definidos: o portal não vai conectar.")
writeFileSync("public/js/config.js",
  `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(anon)};\n`)
console.log("config.js gerado")
