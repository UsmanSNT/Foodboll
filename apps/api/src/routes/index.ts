import {
  LEGAL_DOCUMENT_TYPES,
  legalDocumentInputSchema,
  applicationStatusFilterSchema,
  attendanceInputSchema,
  organizerApplicationInputSchema,
  setOrganizerRegionsInputSchema,
  localeCodeSchema,
  playerSearchQuerySchema,
  matchFeedQuerySchema,
  matchInputSchema,
  regionCodeSchema,
  regionInputSchema,
  setHomeRegionInputSchema,
  paginationSchema,
  paymentInstructionInputSchema,
  paymentStatusFilterSchema,
  rejectPaymentInputSchema,
  updateLanguageInputSchema,
  uuidSchema,
} from '@foodboll/contracts';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import type { ReceiptStorage } from '../storage';
import { requireRole, requireUser } from '../context';
import { AppError } from '../errors';
import { listEnabledLanguages } from '../services/languages';
import { publishLegalDocument, getCurrentLegalDocument } from '../services/legal';
import {
  createMatch,
  getMatch,
  getMatchTranslations,
  listUpcomingMatches,
  replaceMatch,
} from '../services/matches';
import {
  getActivePaymentInstruction,
  getActivePaymentInstructionForAdmin,
  replacePaymentInstructions,
} from '../services/payment-instructions';
import {
  applyToMatch,
  cancelRegistration,
  confirmPayment,
  getAdminPayment,
  getRegistrationDto,
  getRegistrationForActor,
  listMyRegistrations,
  listPaymentsForAdmin,
  MAX_RECEIPT_BYTES,
  readReceipt,
  refundPayment,
  rejectPayment,
  uploadReceipt,
} from '../services/registrations';
import {
  applyToOrganize,
  decideApplication,
  listApplicationsForAdmin,
  listMyApplications,
  listMyOrganizerRegions,
  setOrganizerRegions,
} from '../services/organizers';
import {
  getPlayerProfile,
  getRoster,
  listMatchPlayers,
  markAttendance,
  searchPlayers,
} from '../services/profiles';
import { createRegion, listRegionTree, setHomeRegion, setRegionEnabled } from '../services/regions';
import { buildMe, findUserById, listUsersForAdmin, updateUserLanguage } from '../services/users';

const idParams = z.object({ id: uuidSchema });
const adminApplicationsQuery = paginationSchema.extend({
  status: applicationStatusFilterSchema.default('PENDING'),
});
const legalParams = z.object({ type: z.enum(LEGAL_DOCUMENT_TYPES) });
const adminUsersQuery = paginationSchema.extend({
  language: z.union([localeCodeSchema, z.literal('none')]).optional(),
});

const adminPaymentsQuery = paginationSchema.extend({
  status: paymentStatusFilterSchema.default('PAYMENT_REVIEW'),
});

export function registerRoutes(
  app: FastifyInstance,
  db: Db,
  storage: ReceiptStorage,
  options: { uploadsPerMinute: number; matchFeeKrw: number },
): void {
  const { uploadsPerMinute, matchFeeKrw } = options;
  // Receipts are sent as the raw file body (not multipart), with a larger limit than JSON.
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'application/pdf'],
    { parseAs: 'buffer', bodyLimit: MAX_RECEIPT_BYTES },
    (_request, body, done) => done(null, body),
  );

  // ---- Languages & the current user ------------------------------------------------------
  app.get('/v1/languages', async () => ({ items: await listEnabledLanguages(db) }));

  app.get('/v1/me', async (request) => buildMe(db, requireUser(request), request.ctx.locale));

  app.patch('/v1/me/language', async (request) => {
    const user = requireUser(request);
    const input = updateLanguageInputSchema.parse(request.body);
    const updated = await updateUserLanguage(db, user.id, input);
    return buildMe(db, updated, updated.preferredLanguage ?? request.ctx.locale);
  });

  app.patch('/v1/me/region', async (request) => {
    const user = requireUser(request);
    const { regionCode } = setHomeRegionInputSchema.parse(request.body);
    await setHomeRegion(db, user.id, regionCode);
    return buildMe(db, (await findUserById(db, user.id)) ?? user, request.ctx.locale);
  });

  // ---- Regions -----------------------------------------------------------------------------
  app.get('/v1/regions', async (request) => ({
    items: await listRegionTree(db, request.ctx.locale),
  }));

  app.post('/v1/admin/regions', async (request, reply) => {
    requireRole(request, 'ADMIN');
    const id = await createRegion(db, regionInputSchema.parse(request.body));
    return reply.status(201).send({ id });
  });

  app.patch('/v1/admin/regions/:code', async (request) => {
    requireRole(request, 'ADMIN');
    const { code } = z.object({ code: regionCodeSchema }).parse(request.params);
    const { enabled } = z.strictObject({ enabled: z.boolean() }).parse(request.body);
    await setRegionEnabled(db, code, enabled);
    return { code, enabled };
  });

  // ---- Matches -----------------------------------------------------------------------------
  app.get('/v1/matches', async (request) =>
    listUpcomingMatches(db, request.ctx.locale, matchFeedQuerySchema.parse(request.query), {
      viewerId: request.ctx.user?.id,
    }),
  );

  app.get('/v1/matches/:id', async (request) =>
    getMatch(db, idParams.parse(request.params).id, request.ctx.locale, {
      viewerId: request.ctx.user?.id,
    }),
  );

  app.get('/v1/matches/:id/translations', async (request) =>
    getMatchTranslations(
      db,
      requireRole(request, 'ORGANIZER', 'ADMIN'),
      idParams.parse(request.params).id,
    ),
  );

  app.post('/v1/matches', async (request, reply) => {
    const user = requireRole(request, 'ORGANIZER', 'ADMIN');
    const id = await createMatch(db, user, matchInputSchema.parse(request.body), matchFeeKrw);
    return reply
      .status(201)
      .header('Location', `/v1/matches/${id}`)
      .send(await getMatch(db, id, request.ctx.locale, { viewerId: user.id }));
  });

  app.put('/v1/matches/:id', async (request) => {
    const user = requireRole(request, 'ORGANIZER', 'ADMIN');
    const { id } = idParams.parse(request.params);
    await replaceMatch(db, user, id, matchInputSchema.parse(request.body));
    return getMatch(db, id, request.ctx.locale, { viewerId: user.id });
  });

  // ---- Organizers ------------------------------------------------------------------------
  app.get('/v1/me/organizer-regions', async (request) => ({
    items: await listMyOrganizerRegions(db, requireUser(request), request.ctx.locale),
  }));

  app.get('/v1/me/organizer-applications', async (request) => ({
    items: await listMyApplications(db, requireUser(request), request.ctx.locale),
  }));

  app.post('/v1/organizer-applications', async (request, reply) => {
    const user = requireUser(request);
    const input = organizerApplicationInputSchema.parse(request.body);
    return reply.status(201).send(await applyToOrganize(db, user, input, request.ctx.locale));
  });

  app.get('/v1/admin/organizer-applications', async (request) => {
    requireRole(request, 'ADMIN');
    return listApplicationsForAdmin(
      db,
      request.ctx.locale,
      adminApplicationsQuery.parse(request.query),
    );
  });

  for (const [action, decision] of [
    ['approve', 'APPROVED'],
    ['reject', 'REJECTED'],
  ] as const) {
    app.post(`/v1/admin/organizer-applications/:id/${action}`, async (request) => {
      const admin = requireRole(request, 'ADMIN');
      const { id } = idParams.parse(request.params);
      return decideApplication(db, admin, id, decision, request.ctx.locale);
    });
  }

  app.put('/v1/admin/users/:id/organizer-regions', async (request) => {
    requireRole(request, 'ADMIN');
    const { id } = idParams.parse(request.params);
    const { regionCodes } = setOrganizerRegionsInputSchema.parse(request.body);
    return { organizerRegions: await setOrganizerRegions(db, id, regionCodes) };
  });

  // ---- Players ---------------------------------------------------------------------------
  app.get('/v1/players', async (request) => {
    requireUser(request);
    return searchPlayers(db, request.ctx.locale, playerSearchQuerySchema.parse(request.query));
  });

  app.get('/v1/players/:id', async (request) => {
    requireUser(request);
    return getPlayerProfile(db, idParams.parse(request.params).id, request.ctx.locale);
  });

  app.get('/v1/me/profile', async (request) =>
    getPlayerProfile(db, requireUser(request).id, request.ctx.locale),
  );

  app.get('/v1/matches/:id/players', async (request) => {
    requireUser(request);
    return {
      items: await listMatchPlayers(db, idParams.parse(request.params).id, request.ctx.locale),
    };
  });

  app.get('/v1/matches/:id/roster', async (request) => ({
    items: await getRoster(
      db,
      requireRole(request, 'ORGANIZER', 'ADMIN'),
      idParams.parse(request.params).id,
      request.ctx.locale,
    ),
  }));

  app.put('/v1/matches/:id/attendance', async (request) => {
    const user = requireRole(request, 'ORGANIZER', 'ADMIN');
    const { id } = idParams.parse(request.params);
    await markAttendance(db, user, id, attendanceInputSchema.parse(request.body).marks);
    return { items: await getRoster(db, user, id, request.ctx.locale) };
  });

  // ---- Registration & payment ---------------------------------------------------------------
  app.post('/v1/matches/:id/registrations', async (request, reply) => {
    const user = requireUser(request);
    const registrationId = await applyToMatch(db, storage, user, idParams.parse(request.params).id);
    return reply.status(201).send(await getRegistrationDto(db, registrationId, request.ctx.locale));
  });

  app.get('/v1/me/registrations', async (request) =>
    listMyRegistrations(
      db,
      requireUser(request),
      request.ctx.locale,
      paginationSchema.parse(request.query),
    ),
  );

  app.get('/v1/registrations/:id', async (request) =>
    getRegistrationForActor(
      db,
      requireUser(request),
      idParams.parse(request.params).id,
      request.ctx.locale,
    ),
  );

  app.post('/v1/registrations/:id/cancel', async (request) => {
    const { id } = idParams.parse(request.params);
    await cancelRegistration(db, storage, requireUser(request), id);
    return getRegistrationDto(db, id, request.ctx.locale);
  });

  app.put(
    '/v1/registrations/:id/receipt',
    {
      config: { rateLimit: { max: uploadsPerMinute, timeWindow: '1 minute' } },
      // Authenticate and validate the id BEFORE Fastify reads up to 5 MB of request body.
      onRequest: async (request) => {
        requireUser(request);
        idParams.parse(request.params);
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { id } = idParams.parse(request.params);
      if (!Buffer.isBuffer(request.body)) throw new AppError('INVALID_RECEIPT', 422);
      await uploadReceipt(db, storage, user, id, request.body);
      return getRegistrationDto(db, id, request.ctx.locale);
    },
  );

  app.get('/v1/registrations/:id/receipt', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { bytes, contentType } = await readReceipt(db, storage, requireUser(request), id);
    // Receipts hold bank details: never cached, never sniffed, never allowed to run scripts.
    return reply
      .header('Content-Type', contentType)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'inline')
      .send(bytes);
  });

  // ---- Admin: payment review ---------------------------------------------------------------
  app.get('/v1/admin/payments', async (request) => {
    requireRole(request, 'ADMIN');
    return listPaymentsForAdmin(db, request.ctx.locale, adminPaymentsQuery.parse(request.query));
  });

  app.post('/v1/admin/registrations/:id/payment/confirm', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    const { id } = idParams.parse(request.params);
    await confirmPayment(db, admin, id);
    return getAdminPayment(db, request.ctx.locale, id);
  });

  app.post('/v1/admin/registrations/:id/payment/reject', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    const { id } = idParams.parse(request.params);
    await rejectPayment(db, admin, id, rejectPaymentInputSchema.parse(request.body).reason);
    return getAdminPayment(db, request.ctx.locale, id);
  });

  app.post('/v1/admin/registrations/:id/payment/refund', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    const { id } = idParams.parse(request.params);
    await refundPayment(db, admin, id);
    return getAdminPayment(db, request.ctx.locale, id);
  });

  // ---- Payment instructions ----------------------------------------------------------------
  app.get('/v1/payment-instructions/current', async (request) => {
    requireUser(request);
    return getActivePaymentInstruction(db, request.ctx.locale);
  });

  app.get('/v1/admin/payment-instructions/current', async (request) => {
    requireRole(request, 'ADMIN');
    return getActivePaymentInstructionForAdmin(db);
  });

  app.put('/v1/admin/payment-instructions', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    await replacePaymentInstructions(
      db,
      admin.id,
      paymentInstructionInputSchema.parse(request.body),
    );
    return getActivePaymentInstructionForAdmin(db);
  });

  // ---- Legal documents (terms, privacy, cancellation, refund) -----------------------------
  app.get('/v1/legal/:type', async (request) =>
    getCurrentLegalDocument(db, legalParams.parse(request.params).type, request.ctx.locale),
  );

  app.put('/v1/admin/legal/:type', async (request, reply) => {
    const admin = requireRole(request, 'ADMIN');
    const { type } = legalParams.parse(request.params);
    await publishLegalDocument(db, admin.id, type, legalDocumentInputSchema.parse(request.body));
    return reply.status(201).send(await getCurrentLegalDocument(db, type, request.ctx.locale));
  });

  // ---- Admin: users and their languages ---------------------------------------------------
  app.get('/v1/admin/users', async (request) => {
    requireRole(request, 'ADMIN');
    return listUsersForAdmin(db, adminUsersQuery.parse(request.query));
  });
}
