const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_h2SUkp1zGNTJ@ep-dark-dew-b2r5khle-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require' });
client.connect()
  .then(() => client.query(`
    ALTER TABLE public.event_admin_branding 
    DROP CONSTRAINT IF EXISTS project_branding_project_id_fkey, 
    ADD CONSTRAINT event_admin_branding_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE
  `))
  .then(() => console.log('Fixed FK'))
  .catch(e => console.error(e))
  .finally(() => client.end());
