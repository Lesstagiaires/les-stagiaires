import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import { Client } from 'pg';
import {
  OrganizationCategory,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { EstablishmentsService } from './establishments.service';
import { OrganizationAccessService } from './organization-access.service';
import { OrganizationsService } from './organizations.service';

// ============================================================================
// V6-3 — CATÉGORIE DES ORGANISATIONS, SUR UNE BASE RÉELLE
//
// POURQUOI UNE VRAIE BASE. Trois propriétés ne se prouvent qu'avec de vraies
// écritures :
//
//   1. LE DÉCLENCHEUR. Un double dirait ce qu'on lui dicte ; seul PostgreSQL
//      montre qu'un INSERT sans catégorie est refusé QUEL QUE SOIT le chemin —
//      y compris en contournant entièrement le service.
//   2. LA COEXISTENCE des lignes héritées à `category` nulle avec les nouvelles,
//      qui ne peuvent pas l'être.
//   3. L'IMMUABILITÉ de `orgId` et de la famille au fil des changements.
//
// L'invariant « la catégorie n'est lue par aucune zone sensible » est éprouvé
// ailleurs, par lecture de source : `categorie-non-lue-ailleurs.spec.ts`.
//
// LA BASE EST JETABLE : la base de développement n'est jamais écrite.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_org_category';

function urlDe(base: string): string {
  const u = new URL(process.env.DATABASE_URL_ORIGINE!);
  u.pathname = '/' + base;
  return u.href;
}

async function sqlAdmin(requete: string): Promise<void> {
  const c = new Client({ connectionString: urlDe('postgres') });
  await c.connect();
  try {
    await c.query(requete);
  } finally {
    await c.end();
  }
}

describe('V6-3 : catégorie des organisations (base réelle)', () => {
  let prisma: PrismaService;
  let organizations: OrganizationsService;
  let sql: Client;
  let compteur = 0;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL absente : ce test d'intégration a besoin d'un PostgreSQL " +
          "joignable (docker compose up -d) et d'un fichier api/.env.",
      );
    }
    process.env.DATABASE_URL_ORIGINE = process.env.DATABASE_URL;

    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
    await sqlAdmin(`CREATE DATABASE "${BASE_JETABLE}"`);

    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: urlDe(BASE_JETABLE) },
      stdio: 'pipe',
    });

    process.env.DATABASE_URL = urlDe(BASE_JETABLE);
    prisma = new PrismaService();

    sql = new Client({ connectionString: urlDe(BASE_JETABLE) });
    await sql.connect();

    const audit = new AuditService(prisma);
    const access = new OrganizationAccessService(prisma);
    organizations = new OrganizationsService(
      prisma,
      new ConfigService({ LS_ID_COUNTRY_CODE: 'CM' }),
      audit,
      access,
      // Le parrainage n'intervient pas ici : aucun code n'est fourni.
      { attributeOrganization: () => Promise.resolve(null) } as never,
    );

    for (const [name, selfAssignable] of [
      ['ENTREPRISE', true],
      ['ETABLISSEMENT', true],
    ] as const) {
      await prisma.role.create({ data: { name, selfAssignable } });
    }
  }, 180_000);

  afterAll(async () => {
    await sql?.end();
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
  }, 60_000);

  async function creerUtilisateur(roleName?: string): Promise<string> {
    compteur += 1;
    const user = await prisma.user.create({
      data: {
        phone: `+2376900${String(20000 + compteur).slice(-5)}`,
        password: 'sans-objet-pour-ce-test',
        firstName: 'Test',
        countryOfResidence: 'CM',
      },
    });
    if (roleName) {
      const role = await prisma.role.findFirstOrThrow({
        where: { name: roleName },
      });
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
    return user.id;
  }

  // Une organisation « héritée » : créée en contournant le déclencheur, comme
  // l'aurait été une ligne antérieure à V6-3. C'est le seul moyen honnête de
  // reproduire l'existant, puisque le déclencheur interdit désormais de créer
  // une telle ligne par les voies normales.
  async function creerOrganisationHeritee(
    ownerId: string,
    type: OrganizationType,
  ): Promise<string> {
    compteur += 1;
    const id = `org-heritee-${compteur}`;
    await sql.query(
      'ALTER TABLE "Organization" DISABLE TRIGGER "Organization_category_required"',
    );
    await sql.query(
      `INSERT INTO "Organization" (id, type, "ownerId", name, country, city, "orgId", "updatedAt", category)
       VALUES ($1, $2, $3, 'Organisation héritée', 'CM', 'Douala', $4, now(), NULL)`,
      [id, type, ownerId, `ORG-CM-${compteur}`],
    );
    await sql.query(
      'ALTER TABLE "Organization" ENABLE TRIGGER "Organization_category_required"',
    );
    return id;
  }

  // ==========================================================================
  // S-1 / S-2 — LE DÉCLENCHEUR
  // ==========================================================================
  it('refuse un INSERT direct sans catégorie, hors de tout service', async () => {
    const ownerId = await creerUtilisateur();
    await expect(
      sql.query(
        `INSERT INTO "Organization" (id, type, "ownerId", name, country, city, "updatedAt")
         VALUES ('org-sans-cat', 'ENTREPRISE', $1, 'Sans catégorie', 'CM', 'Douala', now())`,
        [ownerId],
      ),
    ).rejects.toThrow(/doit déclarer sa catégorie/);
  }, 60_000);

  it('accepte un INSERT direct avec une catégorie', async () => {
    const ownerId = await creerUtilisateur();
    await sql.query(
      `INSERT INTO "Organization" (id, type, "ownerId", name, country, city, "updatedAt", category)
       VALUES ('org-avec-cat', 'ENTREPRISE', $1, 'Avec catégorie', 'CM', 'Douala', now(), 'STARTUP')`,
      [ownerId],
    );
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: 'org-avec-cat' },
    });
    expect(org.category).toBe(OrganizationCategory.STARTUP);
  }, 60_000);

  // ==========================================================================
  // S-3 / S-4 — LES ORGANISATIONS HÉRITÉES
  // ==========================================================================
  it('laisse vivre une organisation héritée à catégorie nulle', async () => {
    const ownerId = await creerUtilisateur();
    const id = await creerOrganisationHeritee(
      ownerId,
      OrganizationType.ENTREPRISE,
    );

    const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
    expect(org.category).toBeNull();

    // Elle reste modifiable : le déclencheur ne porte que sur l'insertion, et
    // une organisation ancienne ne perd aucun droit du fait de sa nullité.
    const renommee = await prisma.organization.update({
      where: { id },
      data: { name: 'Renommée sans catégorie' },
    });
    expect(renommee.name).toBe('Renommée sans catégorie');
    expect(renommee.category).toBeNull();
  }, 60_000);

  // LE DROIT ACQUIS LE PLUS SENSIBLE : les apprenants.
  //
  // La garde `assertIsEstablishment` lit `organization.type`, jamais la
  // catégorie. Une nullité de catégorie ne doit donc rien retirer à un
  // établissement antérieur à V6-3 — sans quoi le chantier aurait privé des
  // écoles de leur fonction principale au motif qu'elles n'avaient rien déclaré.
  it('laisse un établissement hérité, sans catégorie, garder l’accès aux apprenants', async () => {
    const ownerId = await creerUtilisateur();
    const apprenantId = await creerUtilisateur();
    const etablissementId = await creerOrganisationHeritee(
      ownerId,
      OrganizationType.ETABLISSEMENT,
    );

    const etablissement = await prisma.organization.findUniqueOrThrow({
      where: { id: etablissementId },
    });
    expect(etablissement.category).toBeNull();

    const apprenant = await prisma.user.findUniqueOrThrow({
      where: { id: apprenantId },
    });

    const establishments = new EstablishmentsService(
      prisma,
      new AuditService(prisma),
      new OrganizationAccessService(prisma),
      { notifyUser: () => Promise.resolve(null) } as never,
    );

    // La garde d'établissement est franchie : l'invitation aboutit, alors même
    // que la catégorie n'a jamais été déclarée.
    const invitation = await establishments.inviteLearner(
      ownerId,
      etablissementId,
      { phone: apprenant.phone! },
    );
    expect(invitation).toBeDefined();
  }, 60_000);

  // ==========================================================================
  // S-5 — LA FAMILLE NE SE TRAVERSE PAS
  // ==========================================================================
  it('refuse une catégorie d’une autre famille à la création', async () => {
    const userId = await creerUtilisateur('ETABLISSEMENT');
    await expect(
      organizations.create(userId, {
        category: OrganizationCategory.COMPANY,
        name: 'École déguisée',
        country: 'CM',
        city: 'Douala',
      }),
    ).rejects.toThrow(/n'appartient pas à la famille/);
  }, 60_000);

  it('refuse une catégorie d’une autre famille au changement', async () => {
    const userId = await creerUtilisateur('ETABLISSEMENT');
    const org = await organizations.create(userId, {
      category: OrganizationCategory.SCHOOL,
      name: 'Lycée',
      country: 'CM',
      city: 'Douala',
    });

    await expect(
      organizations.changeCategory(
        userId,
        org.id,
        OrganizationCategory.STARTUP,
      ),
    ).rejects.toThrow(/n'appartient pas à la famille/);
  }, 60_000);

  it('accepte un changement à l’intérieur de la famille', async () => {
    const userId = await creerUtilisateur('ETABLISSEMENT');
    const org = await organizations.create(userId, {
      category: OrganizationCategory.SCHOOL,
      name: 'Établissement évolutif',
      country: 'CM',
      city: 'Douala',
    });

    const apres = await organizations.changeCategory(
      userId,
      org.id,
      OrganizationCategory.UNIVERSITY,
    );
    expect(apres.category).toBe(OrganizationCategory.UNIVERSITY);
    expect(apres.type).toBe(OrganizationType.ETABLISSEMENT);
  }, 60_000);

  // ==========================================================================
  // S-6 / S-7 — QUI PEUT DÉCLARER
  // ==========================================================================
  it.each([
    [OrganizationMemberRole.RECRUITER],
    [OrganizationMemberRole.VIEWER],
  ])(
    'refuse le changement à un membre %s',
    async (role) => {
      const ownerId = await creerUtilisateur('ENTREPRISE');
      const membreId = await creerUtilisateur();
      const org = await organizations.create(ownerId, {
        category: OrganizationCategory.COMPANY,
        name: 'Entreprise à équipe',
        country: 'CM',
        city: 'Douala',
      });

      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: membreId,
          role,
          status: OrganizationMemberStatus.ACTIVE,
        },
      });

      await expect(
        organizations.changeCategory(
          membreId,
          org.id,
          OrganizationCategory.STARTUP,
        ),
      ).rejects.toThrow(/propriétaire et les administrateurs/);
    },
    60_000,
  );

  it('autorise le propriétaire et un membre ADMIN', async () => {
    const ownerId = await creerUtilisateur('ENTREPRISE');
    const adminId = await creerUtilisateur();
    const org = await organizations.create(ownerId, {
      category: OrganizationCategory.COMPANY,
      name: 'Entreprise administrée',
      country: 'CM',
      city: 'Douala',
    });

    const parLeProprietaire = await organizations.changeCategory(
      ownerId,
      org.id,
      OrganizationCategory.STARTUP,
    );
    expect(parLeProprietaire.category).toBe(OrganizationCategory.STARTUP);

    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: adminId,
        role: OrganizationMemberRole.ADMIN,
        status: OrganizationMemberStatus.ACTIVE,
      },
    });

    const parLAdmin = await organizations.changeCategory(
      adminId,
      org.id,
      OrganizationCategory.NGO,
    );
    expect(parLAdmin.category).toBe(OrganizationCategory.NGO);
  }, 60_000);

  // ==========================================================================
  // S-8 / S-10 — CE QUI NE DOIT PAS BOUGER
  // ==========================================================================
  it('ne touche ni à orgId ni à la famille au fil des changements', async () => {
    const userId = await creerUtilisateur('ETABLISSEMENT');
    const org = await organizations.create(userId, {
      category: OrganizationCategory.SCHOOL,
      name: 'Établissement stable',
      country: 'CM',
      city: 'Douala',
    });

    const orgIdInitial = org.orgId;
    expect(orgIdInitial).toMatch(/^EDU/);

    await organizations.changeCategory(
      userId,
      org.id,
      OrganizationCategory.TRAINING_CENTER,
    );
    await organizations.changeCategory(
      userId,
      org.id,
      OrganizationCategory.UNIVERSITY,
    );

    const apres = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    // Le préfixe dépend de la FAMILLE, qui n'a pas bougé — et l'identifiant est
    // affiché aux utilisateurs : le réécrire romprait une référence publiée.
    expect(apres.orgId).toBe(orgIdInitial);
    expect(apres.type).toBe(OrganizationType.ETABLISSEMENT);
  }, 60_000);

  it('donne le même préfixe et la même famille aux deux familles, quelle que soit la catégorie', async () => {
    const entrepriseId = await creerUtilisateur('ENTREPRISE');
    const ong = await organizations.create(entrepriseId, {
      category: OrganizationCategory.NGO,
      name: 'ONG',
      country: 'CM',
      city: 'Douala',
    });

    // Une ONG reste de la FAMILLE entreprise : son préfixe est ORG, et c'est
    // cette famille — jamais la catégorie — qui déterminera sa formule.
    expect(ong.orgId).toMatch(/^ORG/);
    expect(ong.type).toBe(OrganizationType.ENTREPRISE);
  }, 60_000);
});
