import { seedFixtures } from "./support/fixtures";
export default async function globalSetup() { await seedFixtures(); }
