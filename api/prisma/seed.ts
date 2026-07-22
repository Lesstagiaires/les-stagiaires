import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ROLES: { name: string; description: string; selfAssignable: boolean }[] = [
  { name: 'JEUNE', description: 'Élève, étudiant ou jeune diplômé en recherche de stage', selfAssignable: true },
  { name: 'ENTREPRISE', description: 'Contact représentant une entreprise ou organisation', selfAssignable: true },
  { name: 'ETABLISSEMENT', description: "Contact représentant un établissement d'enseignement", selfAssignable: true },
  { name: 'PARENT', description: "Parent ou représentant légal d'un utilisateur mineur", selfAssignable: true },
  { name: 'ADMIN', description: 'Administration de la plateforme — jamais auto-attribuable', selfAssignable: false },
];

async function main() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, selfAssignable: role.selfAssignable },
      create: role,
    });
  }
  console.log(`Rôles de base initialisés (${ROLES.length}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
