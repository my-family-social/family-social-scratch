import db from "@/components/db/drizzle";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import {
  member,
  discussThread,
  music,
  musicComment,
  musicLike,
  musicLyrics,
  musicPlaylistMedia,
  musicTag,
  pwaMutationRequest,
  musicTemplate,
} from "../schema/family-social-schema-tables";
import { musicTagReference } from "../schema/global-schema-tables";
import {
  AddMusicCommentReturn,
  GetMusicDetailReturn,
  MusicComment,
  MusicDetail,
  MusicHomePageDataReturn,
  MusicLyricsRecord,
  MusicPlaylistMediaRecord,
  MusicRecord,
  MusicTagOption,
  MusicTagType,
  MusicType,
  PlaylistMediaSource,
  PlaylistMediaType,
  MusicTemplateManagementDataReturn,
  MusicTemplateOption,
  MusicTemplateRecord,
  SaveMusicInput,
  SaveMusicLyricsInput,
  SaveMusicLyricsReturn,
  SaveMusicReturn,
  SaveMusicTemplateInput,
  SaveMusicTemplateReturn,
  ToggleMusicLikeReturn,
} from "../types/music";
import {
  createEmptyTipTapDocument,
  createTextTipTapDocument,
  isTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
  serializeTipTapDocument,
} from "../types/poem-term-validation";
import {
  createFamilyActivityRecord,
  createFamilyReactionActivityRecord,
  FAMILY_ACTIVITY_ACTION_TYPES,
} from "./queries-family-activity";
import { loadDiscussionThreadSummariesByTargetIds } from './queries-discuss-threads';
import { logDbQueryError } from "./db-error-logger";
import { canViewTemplate } from "./template-access";

const SUPPORTED_MUSIC_TAG_TYPES: MusicTagType[] = ["genre", "subGenre"];
const GLOBAL_TEMPLATE_FAMILY_ID = 1;
const SUPPORTED_MUSIC_TYPES: MusicType[] = ["album", "song", "lyrics", "playlist"];
const TEMPLATE_MUSIC_TYPES = new Set<MusicType>(["album", "song"]);
const PLAYLIST_MEDIA_SOURCES = new Set<PlaylistMediaSource>(["spotify", "apple_play"]);
const PLAYLIST_MEDIA_TYPES = new Set<PlaylistMediaType>(["song", "playlist"]);

function normalizeMusicType(musicType: string | null | undefined): MusicType {
  if (musicType && SUPPORTED_MUSIC_TYPES.includes(musicType as MusicType)) {
    return musicType as MusicType;
  }

  return "album";
}

function sanitizePlaylistMediaEntries(entries: SaveMusicInput["playlistMedia"]): {
  mediaSource: PlaylistMediaSource;
  mediaSeqNo: number;
  mediaType: PlaylistMediaType;
  mediaUrl: string;
  mediaArtist: string;
  mediaCaption: string;
  mediaImageUrl: string | null;
  useImageUrl: boolean;
  searchArtistImage: boolean;
}[] {
  if (!entries?.length) {
    return [];
  }

  return entries
    .map((entry, index) => {
      const normalizedSource = String(entry.mediaSource ?? "").toLowerCase() as PlaylistMediaSource;
      const normalizedType = String(entry.mediaType ?? "").toLowerCase() as PlaylistMediaType;
      const parsedSeqNo = Number(entry.mediaSeqNo);
      return {
        mediaSource: PLAYLIST_MEDIA_SOURCES.has(normalizedSource) ? normalizedSource : "spotify",
        mediaSeqNo: Number.isInteger(parsedSeqNo) && parsedSeqNo > 0 ? parsedSeqNo : index + 1,
        mediaType: PLAYLIST_MEDIA_TYPES.has(normalizedType) ? normalizedType : "song",
        mediaUrl: entry.mediaUrl.trim(),
        mediaArtist: entry.mediaArtist?.trim() ?? "",
        mediaCaption: entry.mediaCaption?.trim() ?? "",
        mediaImageUrl: entry.mediaImageUrl?.trim() || null,
        useImageUrl: entry.useImageUrl ?? false,
        searchArtistImage: entry.searchArtistImage ?? false,
      };
    })
    .filter((entry) => entry.mediaUrl.length > 0);
}

async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${ Buffer.from(`${ clientId }:${ clientSecret }`).toString("base64") }`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });

    if (!tokenResponse.ok) {
      return null;
    }

    const tokenBody = await tokenResponse.json() as { access_token?: string };
    return tokenBody.access_token ?? null;
  } catch {
    return null;
  }
}

const SPOTIFY_TARGET_IMAGE_SIZE_PX = 300;

type SpotifyImage = { url?: string; width?: number | null; height?: number | null };

// Prefers the smallest image that still meets the target size, so cover art isn't upscaled/blurry.
function selectSpotifyImageUrl(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) {
    return null;
  }

  const sortedBySize = [...images].sort((left, right) => (left.width ?? 0) - (right.width ?? 0));
  const smallestMeetingTarget = sortedBySize.find((image) => (image.width ?? 0) >= SPOTIFY_TARGET_IMAGE_SIZE_PX);

  return smallestMeetingTarget?.url ?? sortedBySize.at(-1)?.url ?? null;
}

async function resolveSpotifyArtistImage(artistName: string, source: PlaylistMediaSource): Promise<string | null> {
  if (source !== "spotify" || !artistName.trim()) {
    return null;
  }

  try {
    const accessToken = await getSpotifyAccessToken();
    if (!accessToken) {
      return null;
    }

    const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=${ encodeURIComponent(artistName) }&type=artist&limit=1`, {
      headers: {
        Authorization: `Bearer ${ accessToken }`,
      },
    });

    if (!searchResponse.ok) {
      return null;
    }

    const searchBody = await searchResponse.json() as {
      artists?: {
        items?: Array<{
          images?: SpotifyImage[];
        }>;
      };
    };

    return selectSpotifyImageUrl(searchBody.artists?.items?.[0]?.images);
  } catch {
    return null;
  }
}

function normalizeAlbumNameForComparison(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function resolveSpotifyAlbumImage(artistName: string, albumTitle: string): Promise<string | null> {
  if (!artistName.trim() || !albumTitle.trim()) {
    return null;
  }

  console.debug("[spotify-album-search] starting search", { artistName, albumTitle });

  try {
    const accessToken = await getSpotifyAccessToken();
    if (!accessToken) {
      console.debug("[spotify-album-search] no access token available");
      return null;
    }

    const artistSearchResponse = await fetch(`https://api.spotify.com/v1/search?q=${ encodeURIComponent(artistName) }&type=artist&limit=1`, {
      headers: {
        Authorization: `Bearer ${ accessToken }`,
      },
    });

    if (!artistSearchResponse.ok) {
      console.debug("[spotify-album-search] artist search request failed", { status: artistSearchResponse.status, artistName });
      return null;
    }

    const artistSearchBody = await artistSearchResponse.json() as {
      artists?: {
        items?: Array<{ id?: string; name?: string }>;
      };
    };

    const matchedArtist = artistSearchBody.artists?.items?.[0];
    const artistId = matchedArtist?.id;
    console.debug("[spotify-album-search] artist search result", { artistName, matchedArtistName: matchedArtist?.name, artistId });
    if (!artistId) {
      return null;
    }

    const albumsResponse = await fetch(
      `https://api.spotify.com/v1/artists/${ artistId }/albums?market=US&include_groups=album&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${ accessToken }`,
        },
      }
    );

    if (!albumsResponse.ok) {
      const errorBody = await albumsResponse.text().catch(() => null);
      console.debug("[spotify-album-search] albums request failed", { status: albumsResponse.status, artistId, errorBody });
      return null;
    }

    const albumsBody = await albumsResponse.json() as {
      items?: Array<{
        name?: string;
        images?: SpotifyImage[];
      }>;
    };

    const normalizedAlbumTitle = normalizeAlbumNameForComparison(albumTitle);
    const albums = albumsBody.items ?? [];
    console.debug("[spotify-album-search] albums fetched", { artistId, albumCount: albums.length, albumNames: albums.map((album) => album.name) });
    const matchedAlbum = albums.find((album) => normalizeAlbumNameForComparison(album.name) === normalizedAlbumTitle)
      ?? albums.find((album) => {
        const normalizedName = normalizeAlbumNameForComparison(album.name);
        return normalizedName.length > 0 && (normalizedName.includes(normalizedAlbumTitle) || normalizedAlbumTitle.includes(normalizedName));
      });

    const resolvedImageUrl = selectSpotifyImageUrl(matchedAlbum?.images);
    console.debug("[spotify-album-search] match result", { albumTitle, matchedAlbumName: matchedAlbum?.name, resolvedImageUrl });
    return resolvedImageUrl;
  } catch (error) {
    console.debug("[spotify-album-search] search threw an error", { artistName, albumTitle, error });
    return null;
  }
}

function toPlaylistMediaRecord(row: {
  id: number;
  mediaSource: string;
  mediaSeqNo: number;
  mediaType: string;
  mediaUrl: string;
  mediaArtist: string;
  mediaCaption: string;
  mediaImageUrl?: string | null;
  useImageUrl?: boolean | null;
  createdAt: Date | null;
  musicId: number;
}): MusicPlaylistMediaRecord {
  const mediaSource = PLAYLIST_MEDIA_SOURCES.has(row.mediaSource as PlaylistMediaSource)
    ? (row.mediaSource as PlaylistMediaSource)
    : "spotify";
  const mediaType = PLAYLIST_MEDIA_TYPES.has(row.mediaType as PlaylistMediaType)
    ? (row.mediaType as PlaylistMediaType)
    : "song";

  return {
    id: row.id,
    mediaSource,
    mediaSeqNo: row.mediaSeqNo,
    mediaType,
    mediaUrl: row.mediaUrl,
    mediaArtist: row.mediaArtist,
    mediaCaption: row.mediaCaption,
    mediaImageUrl: row.mediaImageUrl ?? null,
    useImageUrl: row.useImageUrl ?? true,
    createdAt: row.createdAt ?? new Date(),
    musicId: row.musicId,
  };
}

function isMissingPlaylistMediaColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /column .*media_image_url.*does not exist|column .*use_image_url.*does not exist|undefined column/i.test(error.message);
}

async function loadPlaylistMediaRowsByMusicId(musicId: number) {
  try {
    return await db
      .select({
        id: musicPlaylistMedia.id,
        mediaSource: musicPlaylistMedia.mediaSource,
        mediaSeqNo: musicPlaylistMedia.mediaSeqNo,
        mediaType: musicPlaylistMedia.mediaType,
        mediaUrl: musicPlaylistMedia.mediaUrl,
        mediaArtist: musicPlaylistMedia.mediaArtist,
        mediaCaption: musicPlaylistMedia.mediaCaption,
        mediaImageUrl: musicPlaylistMedia.mediaImageUrl,
        useImageUrl: musicPlaylistMedia.useImageUrl,
        createdAt: musicPlaylistMedia.createdAt,
        musicId: musicPlaylistMedia.musicId,
      })
      .from(musicPlaylistMedia)
      .where(eq(musicPlaylistMedia.musicId, musicId))
      .orderBy(asc(musicPlaylistMedia.mediaSeqNo), asc(musicPlaylistMedia.id));
  } catch (error) {
    if (!isMissingPlaylistMediaColumnError(error)) {
      throw error;
    }

    return await db
      .select({
        id: musicPlaylistMedia.id,
        mediaSource: musicPlaylistMedia.mediaSource,
        mediaSeqNo: musicPlaylistMedia.mediaSeqNo,
        mediaType: musicPlaylistMedia.mediaType,
        mediaUrl: musicPlaylistMedia.mediaUrl,
        mediaArtist: musicPlaylistMedia.mediaArtist,
        mediaCaption: musicPlaylistMedia.mediaCaption,
        createdAt: musicPlaylistMedia.createdAt,
        musicId: musicPlaylistMedia.musicId,
      })
      .from(musicPlaylistMedia)
      .where(eq(musicPlaylistMedia.musicId, musicId))
      .orderBy(asc(musicPlaylistMedia.mediaSeqNo), asc(musicPlaylistMedia.id));
  }
}

async function isViewerFounderForDrafts(familyId: number, viewerMemberId?: number): Promise<boolean> {
  if (!viewerMemberId) {
    return false;
  }

  const viewer = await db
    .select({
      id: member.id,
      isFounder: member.isFounder,
    })
    .from(member)
    .where(and(eq(member.id, viewerMemberId), eq(member.familyId, familyId)))
    .then((rows) => rows[0] ?? null);

  return Boolean(viewer?.isFounder);
}

function canViewDraftPost(
  status: string,
  ownerMemberId: number,
  viewerMemberId: number | undefined,
  viewerIsFounder: boolean
) {
  if (status !== "draft") {
    return true;
  }

  return ownerMemberId === viewerMemberId || viewerIsFounder;
}

export async function deleteMusic(
  musicId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const permissionCheck = actor.isFounder
    ? and(eq(music.id, musicId), eq(music.familyId, actor.familyId))
    : and(eq(music.id, musicId), eq(music.familyId, actor.familyId), eq(music.memberId, actor.memberId));

  const existingMusic = await db
    .select({ id: music.id })
    .from(music)
    .where(permissionCheck)
    .then((rows) => rows[0] ?? null);

  if (!existingMusic) {
    return {
      success: false,
      message: `No music post was found for id: ${ musicId }`,
    };
  }

  try {
    await db
      .delete(discussThread)
      .where(and(eq(discussThread.targetType, "music"), eq(discussThread.targetId, musicId), eq(discussThread.familyId, actor.familyId)));

    await db.delete(music).where(permissionCheck);

    return {
      success: true,
      message: "Music deleted.",
    };
  } catch (error) {
    logDbQueryError("music.deleteMusic", error, {
      musicId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isFounder: actor.isFounder ?? false,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting music",
    };
  }
}

function createSubmitterName(firstName?: string | null, lastName?: string | null) {
  const names = [firstName, lastName].filter(Boolean);

  if (names.length > 0) {
    return names.join(" ");
  }

  return "Unknown Member";
}

function createDefaultMusicTemplateJson() {
  return serializeTipTapDocument({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Music Overview" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Why It Resonates" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Favorite Moments" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Family Notes" }] },
      { type: "paragraph" },
    ],
  });
}

function toTemplateOption(row: {
  id: number;
  templateName: string;
  isGlobalTemplate: boolean;
  status: string;
  templateJson: string;
  memberId: number | null;
  familyId: number | null;
}): MusicTemplateOption {
  const isFamilyGlobalTemplate = row.isGlobalTemplate && row.familyId === GLOBAL_TEMPLATE_FAMILY_ID;

  return {
    id: row.id,
    templateName: row.templateName,
    isGlobalTemplate: isFamilyGlobalTemplate,
    status: row.status,
    templateJson: row.templateJson,
    memberId: row.memberId,
    familyId: row.familyId,
    label: row.templateName,
  };
}

function toLyricsRecord(row: {
  id: number;
  lyricsJson: string;
  status: string;
  updatedAt: Date | null;
  musicId: number;
  memberId: number;
}): MusicLyricsRecord {
  return {
    id: row.id,
    lyricsJson: row.lyricsJson,
    status: row.status,
    updatedAt: row.updatedAt ?? new Date(),
    musicId: row.musicId,
    memberId: row.memberId,
  };
}

async function ensureGlobalMusicTemplate(
  memberId: number,
  canManageGlobalTemplate: boolean
): Promise<MusicTemplateOption | null> {
  const [familyGlobalTemplate] = await db
    .select({
      id: musicTemplate.id,
      templateName: musicTemplate.templateName,
      isGlobalTemplate: musicTemplate.isGlobalTemplate,
      status: musicTemplate.status,
      templateJson: musicTemplate.templateJson,
      memberId: musicTemplate.memberId,
      familyId: musicTemplate.familyId,
    })
    .from(musicTemplate)
    .where(and(eq(musicTemplate.isGlobalTemplate, true), eq(musicTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)))
    .orderBy(asc(musicTemplate.id));

  if (familyGlobalTemplate) {
    return toTemplateOption(familyGlobalTemplate);
  }

  if (!canManageGlobalTemplate) {
    return null;
  }

  const [createdTemplate] = await db
    .insert(musicTemplate)
    .values({
      templateName: `__global-music-${GLOBAL_TEMPLATE_FAMILY_ID}`,
      isGlobalTemplate: true,
      status: "published",
      templateJson: createDefaultMusicTemplateJson(),
      memberId,
      familyId: GLOBAL_TEMPLATE_FAMILY_ID,
    })
    .returning({
      id: musicTemplate.id,
      templateName: musicTemplate.templateName,
      isGlobalTemplate: musicTemplate.isGlobalTemplate,
      status: musicTemplate.status,
      templateJson: musicTemplate.templateJson,
      memberId: musicTemplate.memberId,
      familyId: musicTemplate.familyId,
    });

  return toTemplateOption(createdTemplate);
}

async function loadMusicTagOptions(): Promise<MusicTagOption[]> {
  const rows = await db
    .select({
      id: musicTagReference.id,
      tagName: musicTagReference.tagName,
      tagDesc: musicTagReference.tagDesc,
      tagType: musicTagReference.tagType,
      status: musicTagReference.status,
      seqNo: musicTagReference.seqNo,
    })
    .from(musicTagReference)
    .where(inArray(musicTagReference.tagType, SUPPORTED_MUSIC_TAG_TYPES))
    .orderBy(asc(musicTagReference.tagType), asc(musicTagReference.seqNo), asc(musicTagReference.tagName));

  return rows.map((row) => ({
    id: row.id,
    tagName: row.tagName,
    tagDesc: row.tagDesc,
    tagType: row.tagType as MusicTagType,
    status: row.status,
    seqNo: row.seqNo,
  }));
}

async function loadMusicTemplates(
  familyId: number,
  memberId: number,
  options: {
    includeDraft: boolean;
    includeGlobal: boolean;
    ensureGlobalTemplate?: boolean;
  }
): Promise<MusicTemplateOption[]> {
  const { includeDraft, includeGlobal, ensureGlobalTemplate = false } = options;
  const canManageGlobalTemplate = familyId === GLOBAL_TEMPLATE_FAMILY_ID && ensureGlobalTemplate;

  const fallbackTemplate = ensureGlobalTemplate
    ? await ensureGlobalMusicTemplate(memberId, canManageGlobalTemplate)
    : null;

  const whereCondition = includeGlobal
    ? and(
      or(
        and(eq(musicTemplate.isGlobalTemplate, true), eq(musicTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
        and(
          eq(musicTemplate.isGlobalTemplate, false),
          eq(musicTemplate.familyId, familyId)
        )
      ),
      includeDraft ? undefined : eq(musicTemplate.status, "published")
    )
    : and(
      eq(musicTemplate.familyId, familyId),
      includeDraft ? undefined : eq(musicTemplate.status, "published"),
      eq(musicTemplate.isGlobalTemplate, false)
    );

  const rows = await db
    .select({
      id: musicTemplate.id,
      templateName: musicTemplate.templateName,
      isGlobalTemplate: musicTemplate.isGlobalTemplate,
      status: musicTemplate.status,
      templateJson: musicTemplate.templateJson,
      memberId: musicTemplate.memberId,
      familyId: musicTemplate.familyId,
    })
    .from(musicTemplate)
    .where(whereCondition)
    .orderBy(desc(musicTemplate.isGlobalTemplate), asc(musicTemplate.templateName));

  const mapById = new Map<number, MusicTemplateOption>();

  if (fallbackTemplate) {
    mapById.set(fallbackTemplate.id, fallbackTemplate);
  }

  for (const row of rows.filter((template) => canViewTemplate(template, familyId, memberId))) {
    mapById.set(row.id, toTemplateOption(row));
  }

  return Array.from(mapById.values()).sort((leftTemplate, rightTemplate) => {
    if (leftTemplate.isGlobalTemplate !== rightTemplate.isGlobalTemplate) {
      return leftTemplate.isGlobalTemplate ? -1 : 1;
    }

    return leftTemplate.label.localeCompare(rightTemplate.label);
  });
}

async function loadMusicTemplateManagementRecords(
  familyId: number,
  actorMemberId: number,
  actorIsAdmin: boolean,
  actorIsFounder = false
): Promise<MusicTemplateRecord[]> {
  const canManageGlobalTemplate = actorIsAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

  if (canManageGlobalTemplate) {
    await ensureGlobalMusicTemplate(actorMemberId, true);
  }

  const whereCondition = or(
    and(eq(musicTemplate.isGlobalTemplate, true), eq(musicTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
    and(
      eq(musicTemplate.isGlobalTemplate, false),
      eq(musicTemplate.familyId, familyId)
    )
  );

  const templateRows = await db
    .select({
      id: musicTemplate.id,
      templateName: musicTemplate.templateName,
      status: musicTemplate.status,
      isGlobalTemplate: musicTemplate.isGlobalTemplate,
      templateJson: musicTemplate.templateJson,
      memberId: musicTemplate.memberId,
      familyId: musicTemplate.familyId,
      updatedAt: musicTemplate.updatedAt,
    })
    .from(musicTemplate)
    .where(whereCondition)
    .orderBy(desc(musicTemplate.updatedAt), asc(musicTemplate.templateName));

  const visibleTemplateRows = templateRows.filter((template) => canViewTemplate(template, familyId, actorMemberId));
  const memberIds = [...new Set(visibleTemplateRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))] as number[];
  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  return visibleTemplateRows.map((row) => {
    const isFamilyGlobalTemplate = row.isGlobalTemplate && row.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const canEdit = isFamilyGlobalTemplate
      ? canManageGlobalTemplate
      : row.memberId === actorMemberId || actorIsFounder;

    return {
      id: row.id,
      templateName: row.templateName,
      status: row.status,
      isGlobalTemplate: isFamilyGlobalTemplate,
      templateJson: row.templateJson,
      memberId: row.memberId,
      familyId: row.familyId,
      updatedAt: row.updatedAt ?? new Date(),
      ownerName: isFamilyGlobalTemplate
        ? "Global Template"
        : memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
      memberImageUrl: isFamilyGlobalTemplate ? null : memberImageUrlById.get(row.memberId ?? 0) ?? null,
      canEdit,
    };
  });
}

async function loadLyricsByMusicId(musicId: number): Promise<MusicLyricsRecord | null> {
  const [lyricsRow] = await db
    .select({
      id: musicLyrics.id,
      lyricsJson: musicLyrics.lyricsJson,
      status: musicLyrics.status,
      updatedAt: musicLyrics.updatedAt,
      musicId: musicLyrics.musicId,
      memberId: musicLyrics.memberId,
    })
    .from(musicLyrics)
    .where(eq(musicLyrics.musicId, musicId))
    .orderBy(desc(musicLyrics.updatedAt), desc(musicLyrics.id));

  if (!lyricsRow) {
    return null;
  }

  return toLyricsRecord(lyricsRow);
}

async function loadMusics(familyId: number, viewerMemberId?: number): Promise<MusicRecord[]> {
  const musicRows = await db
    .select()
    .from(music)
    .where(eq(music.familyId, familyId))
    .orderBy(desc(music.updatedAt), asc(music.musicTitle));

  if (!musicRows || musicRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visibleMusicRows = musicRows.filter((row) => canViewDraftPost(row.status, row.memberId, viewerMemberId, viewerIsFounder));

  if (visibleMusicRows.length === 0) {
    return [];
  }

  const musicIds = visibleMusicRows.map((row) => row.id);

  const [commentRows, likeRows, tagRows, lyricsRows, discussionThreadsByMusicId] = await Promise.all([
    db
      .select({
        musicId: musicComment.musicId,
        isMusicReviewer: musicComment.isMusicReviewer,
      })
      .from(musicComment)
      .where(inArray(musicComment.musicId, musicIds)),
    db
      .select({
        musicId: musicLike.musicId,
        memberId: musicLike.memberId,
        likenessDegree: musicLike.likenessDegree,
      })
      .from(musicLike)
      .where(inArray(musicLike.musicId, musicIds)),
    db
      .select({
        musicId: musicTag.musicId,
        tagId: musicTag.tagId,
        tagName: musicTagReference.tagName,
        tagType: musicTagReference.tagType,
      })
      .from(musicTag)
      .innerJoin(musicTagReference, eq(musicTagReference.id, musicTag.tagId))
      .where(inArray(musicTag.musicId, musicIds)),
    db
      .select({
        musicId: musicLyrics.musicId,
      })
      .from(musicLyrics)
      .where(inArray(musicLyrics.musicId, musicIds)),
    loadDiscussionThreadSummariesByTargetIds(familyId, 'music', musicIds),
  ]);

  const memberIds = [...new Set(visibleMusicRows.map((row) => row.memberId))];
  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));
  const submitterMemberIdByMusicId = new Map(visibleMusicRows.map((row) => [row.id, row.memberId]));

  const commentCountByMusicId = new Map<number, number>();
  const noRatingByMusicId = new Map<number, number>();
  const thumbsUpByMusicId = new Map<number, number>();
  const loveByMusicId = new Map<number, number>();
  const submitterLikeByMusicId = new Map<number, number>();
  const viewerLikeByMusicId = new Map<number, number>();
  const tagIdsByMusicId = new Map<number, number[]>();
  const tagNamesByTypeByMusicId = new Map<number, Partial<Record<MusicTagType, string[]>>>();
  const hasLyricsByMusicId = new Set<number>();

  for (const commentRow of commentRows) {
    if (commentRow.isMusicReviewer) {
      continue;
    }

    commentCountByMusicId.set(commentRow.musicId, (commentCountByMusicId.get(commentRow.musicId) ?? 0) + 1);
  }

  for (const likeRow of likeRows) {
    const submitterMemberId = submitterMemberIdByMusicId.get(likeRow.musicId);

    if (submitterMemberId && likeRow.memberId === submitterMemberId) {
      submitterLikeByMusicId.set(likeRow.musicId, likeRow.likenessDegree);
    } else if (likeRow.likenessDegree === 1) {
      thumbsUpByMusicId.set(likeRow.musicId, (thumbsUpByMusicId.get(likeRow.musicId) ?? 0) + 1);
    } else if (likeRow.likenessDegree === 2) {
      loveByMusicId.set(likeRow.musicId, (loveByMusicId.get(likeRow.musicId) ?? 0) + 1);
    } else if (likeRow.likenessDegree === -1) {
      noRatingByMusicId.set(likeRow.musicId, (noRatingByMusicId.get(likeRow.musicId) ?? 0) + 1);
    }

    if (viewerMemberId && likeRow.memberId === viewerMemberId) {
      viewerLikeByMusicId.set(likeRow.musicId, likeRow.likenessDegree);
    }
  }

  for (const tagRow of tagRows) {
    if (!SUPPORTED_MUSIC_TAG_TYPES.includes(tagRow.tagType as MusicTagType)) {
      continue;
    }

    const nextTagIds = tagIdsByMusicId.get(tagRow.musicId) ?? [];
    nextTagIds.push(tagRow.tagId);
    tagIdsByMusicId.set(tagRow.musicId, nextTagIds);

    const tagType = tagRow.tagType as MusicTagType;
    const byType = tagNamesByTypeByMusicId.get(tagRow.musicId) ?? {};
    const nextNames = byType[tagType] ?? [];
    byType[tagType] = [...nextNames, tagRow.tagName];
    tagNamesByTypeByMusicId.set(tagRow.musicId, byType);
  }

  for (const lyricsRow of lyricsRows) {
    hasLyricsByMusicId.add(lyricsRow.musicId);
  }

  return visibleMusicRows.map((row) => ({
    id: row.id,
    musicTitle: row.musicTitle,
    artistName: row.artistName,
    albumName: row.albumName ?? null,
    musicJson: row.musicJson,
    status: row.status,
    musicType: normalizeMusicType(row.musicType),
    musicImageUrl: row.musicImageUrl,
    hasLyrics: hasLyricsByMusicId.has(row.id),
    musicDebutYear: row.musicDebutYear,
    updatedAt: row.updatedAt ?? new Date(),
    memberId: row.memberId,
    familyId: row.familyId,
    submitterName: memberNameById.get(row.memberId) ?? `Member #${row.memberId}`,
    submitterImageUrl: memberImageUrlById.get(row.memberId) ?? null,
    submitterLikenessDegree: submitterLikeByMusicId.get(row.id) ?? null,
    commentCount: commentCountByMusicId.get(row.id) ?? 0,
    noRatingCount: noRatingByMusicId.get(row.id) ?? 0,
    thumbsUpCount: thumbsUpByMusicId.get(row.id) ?? 0,
    loveCount: loveByMusicId.get(row.id) ?? 0,
    likedByMember: (viewerLikeByMusicId.get(row.id) ?? -1) !== -1,
    likenessDegree: viewerLikeByMusicId.get(row.id) ?? null,
    selectedTagIds: tagIdsByMusicId.get(row.id) ?? [],
    tagNamesByType: tagNamesByTypeByMusicId.get(row.id) ?? {},
    discussionThreads: discussionThreadsByMusicId.get(row.id) ?? [],
    hasDiscussionThread: (discussionThreadsByMusicId.get(row.id) ?? []).length > 0,
  }));
}

async function loadMusicDetail(
  familyId: number,
  musicId: number,
  viewerMemberId?: number
): Promise<MusicDetail | null> {
  const musicRows = await db
    .select()
    .from(music)
    .where(and(eq(music.familyId, familyId), eq(music.id, musicId)));

  if (!musicRows || musicRows.length === 0) {
    return null;
  }

  const musicRow = musicRows[0];
  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);

  if (!canViewDraftPost(musicRow.status, musicRow.memberId, viewerMemberId, viewerIsFounder)) {
    return null;
  }

  const [commentRows, likeRows, tagRows, lyrics, playlistMediaRows, discussionThreadsByMusicId] = await Promise.all([
    db
      .select()
      .from(musicComment)
      .where(eq(musicComment.musicId, musicId))
      .orderBy(asc(musicComment.createdAt)),
    db
      .select({
        memberId: musicLike.memberId,
        likenessDegree: musicLike.likenessDegree,
      })
      .from(musicLike)
      .where(eq(musicLike.musicId, musicId)),
    db
      .select({
        tagId: musicTag.tagId,
        tagName: musicTagReference.tagName,
        tagType: musicTagReference.tagType,
      })
      .from(musicTag)
      .innerJoin(musicTagReference, eq(musicTagReference.id, musicTag.tagId))
      .where(eq(musicTag.musicId, musicId)),
    loadLyricsByMusicId(musicId),
    loadPlaylistMediaRowsByMusicId(musicId),
    loadDiscussionThreadSummariesByTargetIds(familyId, 'music', [musicId]),
  ]);

  const commentMemberIds = [...new Set(commentRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const memberIds = [...new Set([musicRow.memberId, ...commentMemberIds])];

  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  const submitterLike = likeRows.find((row) => row.memberId === musicRow.memberId) ?? null;
  const audienceLikeRows = likeRows.filter((row) => row.memberId !== musicRow.memberId);
  const noRatingCount = audienceLikeRows.filter((row) => row.likenessDegree === -1).length;
  const thumbsUpCount = audienceLikeRows.filter((row) => row.likenessDegree === 1).length;
  const loveCount = audienceLikeRows.filter((row) => row.likenessDegree === 2).length;
  const regularCommentRows = commentRows.filter((row) => !row.isMusicReviewer);

  const viewerLike = viewerMemberId
    ? likeRows.find((row) => row.memberId === viewerMemberId)
    : null;

  const tagIdsByMusicId = new Map<number, number[]>();
  const tagNamesByTypeByMusicId = new Map<number, Partial<Record<MusicTagType, string[]>>>();

  for (const tagRow of tagRows) {
    if (!SUPPORTED_MUSIC_TAG_TYPES.includes(tagRow.tagType as MusicTagType)) {
      continue;
    }

    const existingTagIds = tagIdsByMusicId.get(musicId) ?? [];
    existingTagIds.push(tagRow.tagId);
    tagIdsByMusicId.set(musicId, existingTagIds);

    const tagType = tagRow.tagType as MusicTagType;
    const byType = tagNamesByTypeByMusicId.get(musicId) ?? {};
    const currentNames = byType[tagType] ?? [];
    byType[tagType] = [...currentNames, tagRow.tagName];
    tagNamesByTypeByMusicId.set(musicId, byType);
  }

  const musicComments: MusicComment[] = regularCommentRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt ?? new Date(),
    commenterName: memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
    commentJson: normalizeSerializedTipTapDocument(row.commentJson),
  }));

  return {
    id: musicRow.id,
    musicTitle: musicRow.musicTitle,
    artistName: musicRow.artistName,
    albumName: musicRow.albumName ?? null,
    musicJson: musicRow.musicJson,
    status: musicRow.status,
    musicType: normalizeMusicType(musicRow.musicType),
    musicImageUrl: musicRow.musicImageUrl,
    hasLyrics: Boolean(lyrics),
    musicDebutYear: musicRow.musicDebutYear,
    updatedAt: musicRow.updatedAt ?? new Date(),
    memberId: musicRow.memberId,
    familyId: musicRow.familyId,
    submitterName: memberNameById.get(musicRow.memberId) ?? `Member #${musicRow.memberId}`,
    submitterImageUrl: memberImageUrlById.get(musicRow.memberId) ?? null,
    submitterLikenessDegree: submitterLike?.likenessDegree ?? null,
    commentCount: regularCommentRows.length,
    noRatingCount,
    thumbsUpCount,
    loveCount,
    likedByMember: Boolean(viewerLike && viewerLike.likenessDegree !== -1),
    likenessDegree: viewerLike?.likenessDegree ?? null,
    selectedTagIds: tagIdsByMusicId.get(musicId) ?? [],
    tagNamesByType: tagNamesByTypeByMusicId.get(musicId) ?? {},
    playlistMedia: playlistMediaRows.map((row) => toPlaylistMediaRecord(row)),
    discussionThreads: discussionThreadsByMusicId.get(musicId) ?? [],
    hasDiscussionThread: (discussionThreadsByMusicId.get(musicId) ?? []).length > 0,
    musicComments,
    lyrics,
  };
}

export async function getMusicById(
  familyId: number,
  musicId: number,
  viewerMemberId?: number
): Promise<{ success: false; message: string } | { success: true; music: MusicRecord }> {
  const selectedMusic = await loadMusicDetail(familyId, musicId, viewerMemberId);

  if (!selectedMusic) {
    return {
      success: false,
      message: `No music was found for id: ${musicId}`,
    };
  }

  return {
    success: true,
    music: selectedMusic,
  };
}

export async function getMusicLyricsByMusicId(
  familyId: number,
  musicId: number
): Promise<{ success: false; message: string } | { success: true; lyrics: MusicLyricsRecord | null }> {
  const [musicRow] = await db
    .select({
      id: music.id,
      familyId: music.familyId,
    })
    .from(music)
    .where(and(eq(music.id, musicId), eq(music.familyId, familyId)));

  if (!musicRow) {
    return {
      success: false,
      message: `No music was found for id: ${musicId}`,
    };
  }

  return {
    success: true,
    lyrics: await loadLyricsByMusicId(musicId),
  };
}

export async function getMusicHomePageData(
  familyId: number,
  memberId: number,
  isAdmin = false
): Promise<MusicHomePageDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

    const [musics, musicTags, musicTemplates] = await Promise.all([
      loadMusics(familyId, memberId),
      loadMusicTagOptions(),
      loadMusicTemplates(familyId, memberId, {
        includeDraft: false,
        includeGlobal: true,
        ensureGlobalTemplate: canManageGlobalTemplate,
      }),
    ]);

    return {
      success: true,
      musics,
      musicTags,
      musicTemplates,
    };
  } catch (error) {
    logDbQueryError("music.getMusicHomePageData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading music home page data",
    };
  }
}

export async function getMusicTemplateManagementData(
  familyId: number,
  memberId: number,
  isAdmin: boolean,
  isFounder = false
): Promise<MusicTemplateManagementDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const templates = await loadMusicTemplateManagementRecords(familyId, memberId, canManageGlobalTemplate, isFounder);

    return {
      success: true,
      templates,
    };
  } catch (error) {
    logDbQueryError("music.getMusicTemplateManagementData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading music templates",
    };
  }
}

export async function saveMusic(
  input: SaveMusicInput,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<SaveMusicReturn> {
  const normalizedTitle = input.musicTitle.trim();
  const normalizedMusicType = String(input.musicType ?? "").toLowerCase() as MusicType;
  const validMusicType = SUPPORTED_MUSIC_TYPES.includes(normalizedMusicType)
    ? normalizedMusicType
    : null;

  if (!normalizedTitle) {
    return {
      success: false,
      message: "Music title is required.",
    };
  }

  if (!validMusicType) {
    return {
      success: false,
      message: "Music type is invalid.",
    };
  }

  const playlistMediaEntries = await Promise.all(
    sanitizePlaylistMediaEntries(input.playlistMedia).map(async (entry) => {
      const persistedEntry = {
        mediaSource: entry.mediaSource,
        mediaSeqNo: entry.mediaSeqNo,
        mediaType: entry.mediaType,
        mediaUrl: entry.mediaUrl,
        mediaArtist: entry.mediaArtist,
        mediaCaption: entry.mediaCaption,
        mediaImageUrl: entry.mediaImageUrl,
        useImageUrl: entry.useImageUrl,
      };

      if (!entry.searchArtistImage) {
        return persistedEntry;
      }

      const resolvedMediaImageUrl = await resolveSpotifyArtistImage(entry.mediaArtist, entry.mediaSource);
      return {
        ...persistedEntry,
        mediaImageUrl: resolvedMediaImageUrl,
        useImageUrl: Boolean(resolvedMediaImageUrl),
      };
    })
  );

  if (validMusicType === "playlist" && playlistMediaEntries.length === 0) {
    return {
      success: false,
      message: "At least one playlist media entry is required.",
    };
  }

  const sanitizedTagIds = [...new Set(input.selectedTagIds)].filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  const existingMusic = input.id
    ? await db
      .select()
      .from(music)
      .where(and(eq(music.id, input.id), eq(music.familyId, actor.familyId)))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingMusic) {
    return {
      success: false,
      message: `No music was found for id: ${input.id}`,
    };
  }

  if (existingMusic && existingMusic.memberId !== actor.memberId) {
    if (!actor.isFounder) {
      return {
        success: false,
        message: "Only the member who created this music can edit it.",
      };
    }

    // Founders can only change status to/from archived
    const isArchiveStatusChange =
      input.status === "archived" || 
      (existingMusic.status === "archived" && input.status === "published");

    if (!isArchiveStatusChange) {
      return {
        success: false,
        message: "Only the member who created this music can edit it.",
      };
    }

    // For founders doing archive/unarchive, only update status field
    try {
      const [updatedMusic] = await db
        .update(music)
        .set({ status: input.status })
        .where(eq(music.id, existingMusic.id))
        .returning();

      if (!updatedMusic) {
        return {
          success: false,
          message: `Failed to archive/unarchive music with id: ${input.id}`,
        };
      }

      // Load the full updated music to return
      const musics = await loadMusics(actor.familyId, actor.memberId);
      const fullUpdatedMusic = musics.find((m) => m.id === updatedMusic.id);

      if (!fullUpdatedMusic) {
        return {
          success: false,
          message: `Failed to load updated music with id: ${input.id}`,
        };
      }

      return {
        success: true,
        music: fullUpdatedMusic,
        message: updatedMusic.status === "archived" ? "Music archived." : "Music unarchived.",
      };
    } catch (error) {
      logDbQueryError("music.saveMusic.archiveToggle", error, {
        musicId: input.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
        status: input.status,
      });
      return {
        success: false,
        message: "An error occurred while archiving the music.",
      };
    }
  }

  const requiresTemplate = TEMPLATE_MUSIC_TYPES.has(validMusicType);
  const templates = requiresTemplate
    ? await loadMusicTemplates(actor.familyId, actor.memberId, {
      includeDraft: true,
      includeGlobal: true,
      ensureGlobalTemplate: true,
    })
    : [];

  const selectedTemplate = requiresTemplate
    ? templates.find((template) => template.id === input.templateId)
    : null;

  if (requiresTemplate && !selectedTemplate) {
    return {
      success: false,
      message: "A music template must be selected.",
    };
  }

  const submitterLikenessDegree = Number(input.submitterLikenessDegree);
  const hasSubmitterLikenessDegree = [1, 2].includes(submitterLikenessDegree);

  const normalizedAlbumName = validMusicType === "song" ? (input.albumName?.trim() || null) : null;
  const albumSearchTitle = validMusicType === "song" ? (normalizedAlbumName ?? "") : normalizedTitle;

  const resolvedMusicImageUrl = (validMusicType === "album" || validMusicType === "song") && input.searchAlbumImage
    ? await resolveSpotifyAlbumImage(input.artistName, albumSearchTitle)
    : (input.musicImageUrl ?? null);

  console.debug("[spotify-album-search] saveMusic invocation", {
    musicType: validMusicType,
    searchAlbumImage: Boolean(input.searchAlbumImage),
    artistName: input.artistName,
    musicTitle: normalizedTitle,
    albumSearchTitle,
    resolvedMusicImageUrl,
  });

  const normalizedMusicJson = input.musicJson?.trim();
  const parsedMusicJson = normalizedMusicJson ? parseSerializedTipTapDocument(normalizedMusicJson) : null;
  const musicJsonToStore = parsedMusicJson?.success
    ? normalizedMusicJson
    : selectedTemplate?.templateJson || serializeTipTapDocument(createEmptyTipTapDocument());

  try {
    const [persistedMusic] = input.id
      ? await db
        .update(music)
        .set({
          musicTitle: normalizedTitle,
          artistName: input.artistName,
          albumName: normalizedAlbumName,
          musicJson: musicJsonToStore,
          status: input.status,
          musicType: validMusicType,
          musicImageUrl: resolvedMusicImageUrl,
          musicDebutYear: input.musicDebutYear,
          updatedAt: new Date(),
        })
        .where(and(eq(music.id, input.id), eq(music.familyId, actor.familyId)))
        .returning()
      : await db
        .insert(music)
        .values({
          musicTitle: normalizedTitle,
          artistName: input.artistName,
          albumName: normalizedAlbumName,
          musicJson: musicJsonToStore,
          status: input.status,
          musicType: validMusicType,
          musicImageUrl: resolvedMusicImageUrl,
          musicDebutYear: input.musicDebutYear,
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    if (!persistedMusic) {
      return {
        success: false,
        message: "Could not save music.",
      };
    }

    await db.delete(musicTag).where(eq(musicTag.musicId, persistedMusic.id));

    if (sanitizedTagIds.length > 0) {
      await db.insert(musicTag).values(
        sanitizedTagIds.map((tagId) => ({
          musicId: persistedMusic.id,
          tagId,
        }))
      );
    }

    await db.delete(musicPlaylistMedia).where(eq(musicPlaylistMedia.musicId, persistedMusic.id));

    if (validMusicType === "playlist" && playlistMediaEntries.length > 0) {
      const playlistMediaInsertValues = playlistMediaEntries.map((entry) => ({
        mediaSource: entry.mediaSource,
        mediaSeqNo: entry.mediaSeqNo,
        mediaType: entry.mediaType,
        mediaUrl: entry.mediaUrl,
        mediaArtist: entry.mediaArtist,
        mediaCaption: entry.mediaCaption,
        musicId: persistedMusic.id,
        ...(entry.mediaImageUrl !== null || entry.useImageUrl !== undefined
          ? {
              mediaImageUrl: entry.mediaImageUrl ?? null,
              useImageUrl: entry.useImageUrl,
            }
          : {}),
      }));

      try {
        await db.insert(musicPlaylistMedia).values(playlistMediaInsertValues);
      } catch (error) {
        if (!isMissingPlaylistMediaColumnError(error)) {
          throw error;
        }

        await db.insert(musicPlaylistMedia).values(
          playlistMediaEntries.map((entry) => ({
            mediaSource: entry.mediaSource,
            mediaSeqNo: entry.mediaSeqNo,
            mediaType: entry.mediaType,
            mediaUrl: entry.mediaUrl,
            mediaArtist: entry.mediaArtist,
            mediaCaption: entry.mediaCaption,
            musicId: persistedMusic.id,
          }))
        );
      }
    }

    if (!existingMusic) {
      await db.insert(musicComment).values({
        musicId: persistedMusic.id,
        memberId: actor.memberId,
        commentJson: serializeTipTapDocument(createEmptyTipTapDocument()),
        isMusicReviewer: true,
      });
    }

    if (hasSubmitterLikenessDegree) {
      await db.delete(musicLike).where(and(eq(musicLike.musicId, persistedMusic.id), eq(musicLike.memberId, actor.memberId)));

      await db.insert(musicLike).values({
        musicId: persistedMusic.id,
        memberId: actor.memberId,
        likenessDegree: submitterLikenessDegree,
        updatedAt: new Date(),
      });
    }

    if (!existingMusic) {
      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: "Music Salon",
        postName: normalizedTitle,
        postId: persistedMusic.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const musics = await loadMusics(actor.familyId, actor.memberId);
    const savedMusic = musics.find((musicRecord) => musicRecord.id === persistedMusic.id);

    if (!savedMusic) {
      return {
        success: false,
        message: "Music was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      music: savedMusic,
      message: input.id ? "Music updated." : "Music added.",
    };
  } catch (error) {
    logDbQueryError("music.saveMusic", error, {
      musicId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: input.status,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving music",
    };
  }
}

export async function saveMusicTemplate(
  input: SaveMusicTemplateInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin: boolean;
    isFounder?: boolean;
  }
): Promise<SaveMusicTemplateReturn> {
  const canManageGlobalTemplate = actor.isAdmin && actor.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
  const normalizedName = input.templateName.trim();
  const normalizedStatus = input.status.trim().toLowerCase();
  const normalizedJson = input.templateJson.trim();

  if (!normalizedName) {
    return {
      success: false,
      message: "Template name is required.",
    };
  }

  if (!["draft", "published"].includes(normalizedStatus)) {
    return {
      success: false,
      message: "Template status must be draft or published.",
    };
  }

  const jsonResult = parseSerializedTipTapDocument(normalizedJson);

  if (!jsonResult.success) {
    return {
      success: false,
      message: "Template content must be valid TipTap JSON.",
    };
  }

  const existingTemplate = input.id
    ? await db
      .select()
      .from(musicTemplate)
      .where(eq(musicTemplate.id, input.id))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingTemplate) {
    return {
      success: false,
      message: `No music template was found for id: ${input.id}`,
    };
  }

  if (existingTemplate) {
    const isFamilyGlobalTemplate = existingTemplate.isGlobalTemplate && existingTemplate.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const canEditExisting = isFamilyGlobalTemplate
      ? canManageGlobalTemplate && existingTemplate.familyId === GLOBAL_TEMPLATE_FAMILY_ID
      : (existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder)) && existingTemplate.familyId === actor.familyId;

    if (!canEditExisting) {
      return {
        success: false,
        message: "Only the template owner or the family founder can edit this music template.",
      };
    }
  }

  try {
    const [persistedTemplate] = input.id
      ? await db
        .update(musicTemplate)
        .set({
          templateName: normalizedName,
          status: normalizedStatus,
          templateJson: normalizedJson,
          updatedAt: new Date(),
        })
        .where(eq(musicTemplate.id, input.id))
        .returning()
      : await db
        .insert(musicTemplate)
        .values({
          templateName: normalizedName,
          status: normalizedStatus,
          templateJson: normalizedJson,
          isGlobalTemplate: false,
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    if (!persistedTemplate) {
      return {
        success: false,
        message: "Could not save music template.",
      };
    }

    const templates = await loadMusicTemplateManagementRecords(actor.familyId, actor.memberId, canManageGlobalTemplate, Boolean(actor.isFounder));
    const savedTemplate = templates.find((template) => template.id === persistedTemplate.id);

    if (!savedTemplate) {
      return {
        success: false,
        message: "Music template was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      template: savedTemplate,
      message: input.id ? "Music template updated." : "Music template added.",
    };
  } catch (error) {
    logDbQueryError("music.saveMusicTemplate", error, {
      templateId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving music template",
    };
  }
}

export async function deleteMusicTemplate(
  templateId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const existingTemplate = await db
    .select()
    .from(musicTemplate)
    .where(eq(musicTemplate.id, templateId))
    .then((rows) => rows[0] ?? null);

  if (!existingTemplate) {
    return {
      success: false,
      message: `No music template was found for id: ${templateId}`,
    };
  }

  if (existingTemplate.isGlobalTemplate) {
    return {
      success: false,
      message: "Global templates cannot be deleted.",
    };
  }

  const isOwnerOrFounder = existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder);

  if (existingTemplate.familyId !== actor.familyId || !isOwnerOrFounder) {
    return {
      success: false,
      message: "Only the template owner or the family founder can delete this template.",
    };
  }

  try {
    await db.delete(musicTemplate).where(eq(musicTemplate.id, templateId));

    return {
      success: true,
      message: `Template "${existingTemplate.templateName}" deleted.`,
    };
  } catch (error) {
    logDbQueryError("music.deleteMusicTemplate", error, {
      templateId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting music template",
    };
  }
}

export async function saveMusicLyrics(
  input: SaveMusicLyricsInput,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<SaveMusicLyricsReturn> {
  const parsedLyrics = parseSerializedTipTapDocument(input.lyricsJson.trim());

  if (!parsedLyrics.success) {
    return {
      success: false,
      message: "Lyrics content must be valid TipTap JSON.",
    };
  }

  if (!["draft", "published"].includes(input.status)) {
    return {
      success: false,
      message: "Lyrics status must be draft or published.",
    };
  }

  const [musicRow] = await db
    .select({
      id: music.id,
      familyId: music.familyId,
      musicType: music.musicType,
      memberId: music.memberId,
    })
    .from(music)
    .where(and(eq(music.id, input.musicId), eq(music.familyId, actor.familyId)));

  if (!musicRow) {
    return {
      success: false,
      message: `No music was found for id: ${input.musicId}`,
    };
  }

  const musicType = normalizeMusicType(musicRow.musicType);

  if (musicType !== "song") {
    return {
      success: false,
      message: "Lyrics can only be added for songs.",
    };
  }

  try {
    const [existingLyrics] = await db
      .select()
      .from(musicLyrics)
      .where(eq(musicLyrics.musicId, input.musicId))
      .orderBy(desc(musicLyrics.updatedAt), desc(musicLyrics.id));

    if (existingLyrics && existingLyrics.memberId !== actor.memberId) {
      return {
        success: false,
        message: "Only the member who created these lyrics can edit them.",
      };
    }

    if (!existingLyrics && musicRow.memberId !== actor.memberId) {
      return {
        success: false,
        message: "Only the member who created this music can add lyrics.",
      };
    }

    const [savedRow] = existingLyrics
      ? await db
        .update(musicLyrics)
        .set({
          lyricsJson: input.lyricsJson.trim(),
          status: input.status,
          memberId: actor.memberId,
          updatedAt: new Date(),
        })
        .where(eq(musicLyrics.id, existingLyrics.id))
        .returning({
          id: musicLyrics.id,
          lyricsJson: musicLyrics.lyricsJson,
          status: musicLyrics.status,
          updatedAt: musicLyrics.updatedAt,
          musicId: musicLyrics.musicId,
          memberId: musicLyrics.memberId,
        })
      : await db
        .insert(musicLyrics)
        .values({
          lyricsJson: input.lyricsJson.trim(),
          status: input.status,
          musicId: input.musicId,
          memberId: actor.memberId,
          updatedAt: new Date(),
        })
        .returning({
          id: musicLyrics.id,
          lyricsJson: musicLyrics.lyricsJson,
          status: musicLyrics.status,
          updatedAt: musicLyrics.updatedAt,
          musicId: musicLyrics.musicId,
          memberId: musicLyrics.memberId,
        });

    if (!savedRow) {
      return {
        success: false,
        message: "Could not save lyrics.",
      };
    }

    return {
      success: true,
      lyrics: toLyricsRecord(savedRow),
      message: existingLyrics ? "Lyrics updated." : "Lyrics added.",
    };
  } catch (error) {
    logDbQueryError("music.saveMusicLyrics", error, {
      musicId: input.musicId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving lyrics",
    };
  }
}

export async function getMusicDetail(
  familyId: number,
  musicId: number,
  viewerMemberId?: number
): Promise<GetMusicDetailReturn> {
  try {
    const selectedMusic = await loadMusicDetail(familyId, musicId, viewerMemberId);

    if (!selectedMusic) {
      return {
        success: false,
        message: `No music was found for id: ${musicId}`,
      };
    }

    return {
      success: true,
      music: selectedMusic,
    };
  } catch (error) {
    logDbQueryError("music.getMusicDetail", error, { familyId, musicId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading music detail",
    };
  }
}

export async function toggleMusicLike(
  musicId: number,
  likenessDegree: number,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<ToggleMusicLikeReturn> {
  if (![-1, 1, 2].includes(likenessDegree)) {
    return {
      success: false,
      message: "Music reactions must be thumbs down, thumbs up, or love.",
    };
  }

  const selectedMusic = await loadMusicDetail(actor.familyId, musicId, actor.memberId);

  if (!selectedMusic) {
    return {
      success: false,
      message: `No music was found for id: ${musicId}`,
    };
  }

  if (selectedMusic.memberId === actor.memberId) {
    return {
      success: false,
      message: "You cannot react to your own music.",
    };
  }

  try {
    await db.delete(musicLike).where(and(eq(musicLike.musicId, musicId), eq(musicLike.memberId, actor.memberId)));
    await db.insert(musicLike).values({
      musicId,
      memberId: actor.memberId,
      likenessDegree,
      updatedAt: new Date(),
    });

    if (likenessDegree === 1 || likenessDegree === 2) {
      await createFamilyReactionActivityRecord({
        reactionType: likenessDegree === 2 ? "love" : "like",
        featureName: "Music Salon",
        postName: selectedMusic.musicTitle,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const updatedMusic = await loadMusicDetail(actor.familyId, musicId, actor.memberId);

    if (!updatedMusic) {
      return {
        success: false,
        message: "Music reaction was saved but the music could not be reloaded.",
      };
    }

    return {
      success: true,
      music: updatedMusic,
      message: likenessDegree === -1 ? "Thumbs down saved." : likenessDegree === 1 ? "Thumbs up saved." : "Love saved.",
    };
  } catch (error) {
    logDbQueryError("music.toggleMusicLike", error, {
      musicId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      likenessDegree,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving music reaction",
    };
  }
}

export async function addMusicComment(
  input: {
    musicId: number;
    commentText: string;
    clientRequestId?: string;
  },
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<AddMusicCommentReturn> {
  const normalizedComment = input.commentText.trim();

  const parsedComment = parseSerializedTipTapDocument(normalizedComment);
  const commentJson = parsedComment.success
    ? serializeTipTapDocument(parsedComment.content)
    : serializeTipTapDocument(createTextTipTapDocument(normalizedComment));

  if (parsedComment.success && isTipTapDocumentEmpty(parsedComment.content)) {
    return {
      success: false,
      message: "Comment cannot be empty.",
    };
  }

  if (!parsedComment.success && !normalizedComment) {
    return {
      success: false,
      message: "Comment text is required.",
    };
  }

  const selectedMusic = await loadMusicDetail(actor.familyId, input.musicId, actor.memberId);

  if (!selectedMusic) {
    return {
      success: false,
      message: `No music was found for id: ${input.musicId}`,
    };
  }

  try {
    const duplicateRequest = input.clientRequestId
      ? await db
        .insert(pwaMutationRequest)
        .values({
          requestKey: input.clientRequestId,
          mutationName: 'music.addMusicComment',
          entityType: 'music',
          entityId: input.musicId,
          familyId: actor.familyId,
          memberId: actor.memberId,
        })
        .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
        .returning({ id: pwaMutationRequest.id })
      : [{ id: 0 }];

    if (input.clientRequestId && duplicateRequest.length === 0) {
      const existingUpdatedMusic = await loadMusicDetail(actor.familyId, input.musicId, actor.memberId);

      if (!existingUpdatedMusic) {
        return {
          success: false,
          message: 'Music comment was already submitted, but the music could not be reloaded.',
        };
      }

      return {
        success: true,
        music: existingUpdatedMusic,
        message: 'Comment already synced.',
      };
    }

    await db.insert(musicComment).values({
      musicId: input.musicId,
      memberId: actor.memberId,
      commentJson,
      isMusicReviewer: false,
      createdAt: new Date(),
    });

    const updatedMusic = await loadMusicDetail(actor.familyId, input.musicId, actor.memberId);

    if (!updatedMusic) {
      return {
        success: false,
        message: "Music comment was saved but the music could not be reloaded.",
      };
    }

    return {
      success: true,
      music: updatedMusic,
      message: "Music comment added.",
    };
  } catch (error) {
    logDbQueryError("music.addMusicComment", error, {
      musicId: input.musicId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving music comment",
    };
  }
}
