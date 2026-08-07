/** Profile and preference writes. */
import { supabase } from './core-supabase.js';
import { unwrap, AppError } from './core-errors.js';
import { store } from './core-store.js';
import { emit, EVENTS } from './core-events.js';
import { validateUsername } from './core-auth.js';

const EDITABLE = [
  'display_name', 'bio', 'avatar_url', 'target_score', 'test_date',
  'grade_level', 'timezone', 'is_public', 'preferences', 'onboarded_at'
];

export async function updateProfile(patch) {
  const userId = store.get('user')?.id;
  if (!userId) throw new AppError('You need to be signed in.');

  const clean = Object.fromEntries(
    Object.entries(patch).filter(([key]) => EDITABLE.includes(key))
  );
  if (!Object.keys(clean).length) return store.get('profile');

  const profile = unwrap(
    await supabase.from('profiles').update(clean).eq('id', userId).select().single()
  );
  store.set({ profile });
  emit(EVENTS.PROFILE_UPDATED, profile);
  return profile;
}

export async function updateUsername(username) {
  const problem = validateUsername(username);
  if (problem) throw new AppError(problem);

  const userId = store.get('user')?.id;
  const { data, error } = await supabase
    .from('profiles').update({ username }).eq('id', userId).select().single();

  if (error?.code === '23505') throw new AppError('That username is already taken.');
  if (error) throw new AppError('Could not update your username.', { cause: error });

  store.set({ profile: data });
  return data;
}

export async function isUsernameAvailable(username) {
  if (validateUsername(username)) return false;
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('username', username);
  return (count ?? 0) === 0;
}

export async function setPreference(key, value) {
  const current = store.get('profile')?.preferences || {};
  return updateProfile({ preferences: { ...current, [key]: value } });
}

/** Avatar upload → Supabase Storage bucket `avatars`, path `<uid>/avatar.<ext>`. */
export async function uploadAvatar(file) {
  const userId = store.get('user')?.id;
  if (!userId) throw new AppError('You need to be signed in.');

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new AppError('Use a PNG, JPEG, or WebP image.');
  }
  if (file.size > 2 * 1024 * 1024) throw new AppError('Images must be under 2 MB.');

  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${userId}/avatar.${ext}`;

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
  if (error) throw new AppError('Upload failed. Try a different image.', { cause: error });

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
  return updateProfile({ avatar_url: `${publicUrl}?v=${Date.now()}` });
}

/** GDPR-style export: everything we hold about this user, as JSON. */
export async function exportMyData() {
  const userId = store.get('user')?.id;
  const [profile, stats, attempts, sessions, bookmarks, achievements] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('user_stats').select('*').eq('user_id', userId).single(),
    supabase.from('attempts').select('*').order('created_at'),
    supabase.from('practice_sessions').select('*').order('started_at'),
    supabase.from('bookmarks').select('*'),
    supabase.from('user_achievements').select('*')
  ]);

  return {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    stats: stats.data,
    attempts: attempts.data,
    sessions: sessions.data,
    bookmarks: bookmarks.data,
    achievements: achievements.data
  };
}
