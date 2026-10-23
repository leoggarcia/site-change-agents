import type { DataSource } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { Site } from '../sites/site.entity.js';
import { User } from '../users/user.entity.js';

/** Demo data: the three fictional test sites, their owners and one agency user. Safe to run again. */
const demo = [
  {
    client: { name: 'Luna Café', plan: 'basic' as const },
    owner: { name: 'Sofia Ramirez', email: 'sofia@lunacafe.example' },
    site: { id: 'luna-cafe', name: 'Luna Café' },
  },
  {
    client: { name: 'BrightSmile Dental', plan: 'standard' as const },
    owner: { name: 'Dr. Emily Chen', email: 'emily@brightsmile.example' },
    site: { id: 'brightsmile-dental', name: 'BrightSmile Dental' },
  },
  {
    client: { name: 'Northside Accounting', plan: 'premium' as const },
    owner: { name: 'Robert Hale', email: 'robert@northside-accounting.example' },
    site: { id: 'northside-accounting', name: 'Northside Accounting' },
  },
];

export async function seedDemoData(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    for (const entry of demo) {
      let client = await manager.findOneBy(Client, { name: entry.client.name });
      client ??= await manager.save(manager.create(Client, entry.client));

      if (!(await manager.existsBy(User, { email: entry.owner.email }))) {
        await manager.save(manager.create(User, { ...entry.owner, role: 'client', clientId: client.id }));
      }
      if (!(await manager.existsBy(Site, { id: entry.site.id }))) {
        await manager.save(manager.create(Site, { ...entry.site, clientId: client.id }));
      }
    }

    const agencyEmail = 'team@agency.example';
    if (!(await manager.existsBy(User, { email: agencyEmail }))) {
      await manager.save(manager.create(User, { name: 'Agency team', email: agencyEmail, role: 'agency', clientId: null }));
    }
  });
}
