/**
 * Seed script for PoliticalFigure database.
 *
 * Run with: npx tsx src/seed-political.ts
 * Requires DATABASE_URL in packages/database/.env
 *
 * Seeds 20 key Argentine political figures with party, position, tier,
 * and common aliases for NER matching.
 */

import { prisma } from "./client.js";

const SEED_FIGURES = [
  {
    name: "Javier Milei",
    aliases: ["Javier Milei", "Milei", "el Presidente", "presidente Milei"],
    party: "LLA",
    position: "presidente",
    tier: 1,
  },
  {
    name: "Victoria Villarruel",
    aliases: ["Victoria Villarruel", "Villarruel", "la Vicepresidenta"],
    party: "LLA",
    position: "vicepresidente",
    tier: 1,
  },
  {
    name: "Cristina Fernández de Kirchner",
    aliases: [
      "Cristina Fernández de Kirchner",
      "Cristina Kirchner",
      "CFK",
      "Cristina",
    ],
    party: "FdT",
    position: "ex presidente",
    tier: 1,
  },
  {
    name: "Patricia Bullrich",
    aliases: ["Patricia Bullrich", "Bullrich", "ministra Bullrich"],
    party: "PRO",
    position: "ministro",
    tier: 1,
  },
  {
    name: "Sergio Massa",
    aliases: ["Sergio Massa", "Massa"],
    party: "FdT",
    position: "ex ministro",
    tier: 1,
  },
  {
    name: "Mauricio Macri",
    aliases: ["Mauricio Macri", "Macri"],
    party: "PRO",
    position: "ex presidente",
    tier: 1,
  },
  {
    name: "Axel Kicillof",
    aliases: ["Axel Kicillof", "Kicillof", "gobernador Kicillof"],
    party: "FdT",
    position: "gobernador",
    tier: 1,
  },
  {
    name: "Jorge Macri",
    aliases: ["Jorge Macri", "Jorge Macri"],
    party: "PRO",
    position: "jefe de gobierno",
    tier: 2,
  },
  {
    name: "Santiago Caputo",
    aliases: ["Santiago Caputo", "Caputo", "Santiago Caputo"],
    party: "LLA",
    position: "asesor",
    tier: 2,
  },
  {
    name: "Karina Milei",
    aliases: ["Karina Milei", "Karina Milei", "la hermana del presidente"],
    party: "LLA",
    position: "secretario general",
    tier: 2,
  },
  {
    name: "Guillermo Francos",
    aliases: ["Guillermo Francos", "Francos", "jefe de gabinete"],
    party: "LLA",
    position: "jefe de gabinete",
    tier: 1,
  },
  {
    name: "Luis Caputo",
    aliases: ["Luis Caputo", "Caputo", "ministro Caputo", "Toto Caputo"],
    party: "LLA",
    position: "ministro",
    tier: 1,
  },
  {
    name: "Sandra Pettovello",
    aliases: ["Sandra Pettovello", "Pettovello", "ministra Pettovello"],
    party: "LLA",
    position: "ministro",
    tier: 2,
  },
  {
    name: "Mariano Cúneo Libarona",
    aliases: [
      "Mariano Cúneo Libarona",
      "Cúneo Libarona",
      "ministro Cúneo Libarona",
    ],
    party: "LLA",
    position: "ministro",
    tier: 2,
  },
  {
    name: "Diana Mondino",
    aliases: ["Diana Mondino", "Mondino", "canciller Mondino"],
    party: "LLA",
    position: "canciller",
    tier: 1,
  },
  {
    name: "Martín Menem",
    aliases: ["Martín Menem", "Menem", "diputado Menem"],
    party: "LLA",
    position: "diputado",
    tier: 2,
  },
  {
    name: "Horacio Rodríguez Larreta",
    aliases: ["Horacio Rodríguez Larreta", "Larreta", "Rodríguez Larreta"],
    party: "PRO",
    position: "ex jefe de gobierno",
    tier: 2,
  },
  {
    name: "Myriam Bregman",
    aliases: ["Myriam Bregman", "Bregman", "diputada Bregman"],
    party: "PTS",
    position: "diputado",
    tier: 2,
  },
  {
    name: "Nicolás del Caño",
    aliases: ["Nicolás del Caño", "Del Caño", "diputado Del Caño"],
    party: "PTS",
    position: "diputado",
    tier: 3,
  },
  {
    name: "Alberto Fernández",
    aliases: ["Alberto Fernández", "Alberto", "ex presidente Alberto"],
    party: "FdT",
    position: "ex presidente",
    tier: 1,
  },
];

async function seed() {
  console.log("[seed-political] Seeding political figures...");
  let created = 0;
  let skipped = 0;

  for (const figure of SEED_FIGURES) {
    const existing = await prisma.politicalFigure.findUnique({
      where: { name: figure.name },
    });

    if (existing) {
      console.log(`  ⏭  ${figure.name} already exists, skipping`);
      skipped++;
      continue;
    }

    await prisma.politicalFigure.create({
      data: {
        name: figure.name,
        aliases: figure.aliases,
        party: figure.party,
        position: figure.position,
        tier: figure.tier,
      },
    });
    console.log(`  ✅ ${figure.name} (${figure.party}, tier ${figure.tier})`);
    created++;
  }

  const total = await prisma.politicalFigure.count();
  console.log(`\n[seed-political] Done. ${created} created, ${skipped} skipped. Total: ${total}`);
}

seed()
  .catch((err) => {
    console.error("[seed-political] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
