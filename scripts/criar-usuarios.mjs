// Cria (ou atualiza) os usuários do portal no Supabase Auth.
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SENHA_INICIAL='...' npm run usuarios
import { createClient } from "@supabase/supabase-js"
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SENHA_INICIAL } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SENHA_INICIAL) {
  console.error("Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SENHA_INICIAL."); process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const USUARIOS = [
  { email: "manutencao@nebulize.com.br", nome: "Thalison", papel: "supervisor" },
  { email: "manutencao02@nebulize.com.br", nome: "Katielen", papel: "auxiliar" },
  { email: "manutencao03@nebulize.com.br", nome: "Mayara", papel: "auxiliar" },
]
const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 })
for (const u of USUARIOS) {
  const existente = lista?.users?.find(x => x.email === u.email)
  let id = existente?.id
  if (!existente) {
    const { data, error } = await db.auth.admin.createUser({
      email: u.email, password: SENHA_INICIAL, email_confirm: true, user_metadata: { nome: u.nome, papel: u.papel },
    })
    if (error) { console.error(u.email, error.message); continue }
    id = data.user.id
    console.log("criado:", u.email)
  } else console.log("já existe:", u.email)
  await db.from("perfis").upsert({ id, nome: u.nome, email: u.email, papel: u.papel, ativo: true })
}
console.log("ok")
