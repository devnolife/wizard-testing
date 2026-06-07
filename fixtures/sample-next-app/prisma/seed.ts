// Sample seed script for the throwaway fixture. The Copilot Testing Wizard's
// seed detector reads files like this to find local test credentials so the
// agent can log in without manual setup. These accounts are fake.
export const seedAccounts = [
  { email: "admin@example.test", password: "admin1234", role: "admin" },
  { email: "demo@example.test", password: "demo1234", role: "user" },
];

export async function seed() {
  // In a real project this would write the accounts above to the database.
  return seedAccounts;
}
