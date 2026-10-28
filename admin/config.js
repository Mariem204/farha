// Farha · back-office · configuration publique
// Ces deux valeurs sont PUBLIQUES par conception : elles ne donnent accès qu'à ce que
// les règles RLS de Supabase autorisent. Ne mettez JAMAIS ici la clé « service_role »
// ni une clé « secret » (sb_secret_...).
//
// Où les trouver : Supabase → Project Settings → API (ou « API Keys »)
//   - SUPABASE_URL      : « Project URL », ex. https://abcdefghijkl.supabase.co
//   - SUPABASE_ANON_KEY : clé « anon public » (eyJ...) ou « publishable » (sb_publishable_...)
window.FARHA_CONFIG = {
  SUPABASE_URL: 'https://hxipvvqtqpuhjgkkcdzw.supabase.co',
  SUPABASE_ANON_KEY: 'COLLE_ICI_TA_CLE_PUBLISHABLE_COMPLETE'
};

