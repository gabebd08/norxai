// ═══════════════════════════════════════════════════════════
// NORX AI — Supabase Data Layer
// All user data syncs to Supabase instead of localStorage
// Falls back to localStorage if offline
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://eyofcybilytepouerssp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5b2ZjeWJpbHl0ZXBvdWVyc3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODk3MDMsImV4cCI6MjA5MTM2NTcwM30.6Kj2I5guyQFaBW3EryWMeWGzbmitMfBCRdTMXzBR3ZE';

// ── AUTH ──────────────────────────────────────────────────
async function getSession() {
  const token = localStorage.getItem('norx-auth-token');
  const userId = localStorage.getItem('norx-user-id');
  if (!token || !userId) return null;
  return { token, userId };
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/login';
    return null;
  }
  return session;
}

// ── SUPABASE REST HELPER ──────────────────────────────────
async function sbFetch(path, options = {}) {
  const session = await getSession();
  const headers = {
    'apikey': SUPABASE_ANON,
    'Content-Type': 'application/json',
    ...(session ? { 'Authorization': `Bearer ${session.token}` } : {}),
    ...options.headers,
  };
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `DB error ${resp.status}`);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ── PROFILE ──────────────────────────────────────────────
async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  try {
    const rows = await sbFetch(`profiles?id=eq.${session.userId}&select=*`);
    return rows?.[0] || null;
  } catch(e) {
    console.error('getProfile error:', e);
    return null;
  }
}

async function updateProfile(data) {
  const session = await getSession();
  if (!session) return;
  await sbFetch(`profiles?id=eq.${session.userId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    headers: { 'Prefer': 'return=minimal' },
  });
}

// ── PLAN LIMITS ──────────────────────────────────────────
const PLAN_LIMITS = {
  starter: { contacts: 500, sms: 1000, searches: 5, campaigns: 3 },
  pro:     { contacts: 2500, sms: 5000, searches: 20, campaigns: 10 },
  agency:  { contacts: Infinity, sms: Infinity, searches: Infinity, campaigns: Infinity },
};

async function checkLimit(type) {
  const profile = await getProfile();
  if (!profile) return { allowed: false, reason: 'Not logged in' };
  if (profile.is_beta) return { allowed: true };

  const plan = profile.plan || 'starter';
  const limits = PLAN_LIMITS[plan];
  const month = new Date().toISOString().slice(0, 7);

  try {
    const usage = await sbFetch(`usage?user_id=eq.${profile.id}&month=eq.${month}&select=*`);
    const u = usage?.[0] || {};

    if (type === 'contact' && (u.contacts_count || 0) >= limits.contacts) {
      return { allowed: false, reason: `Contact limit reached (${limits.contacts} on ${plan} plan). Upgrade to add more.`, upgrade: true };
    }
    if (type === 'sms' && (u.sms_sent || 0) >= limits.sms) {
      return { allowed: false, reason: `SMS limit reached (${limits.sms}/mo on ${plan} plan). Upgrade for more.`, upgrade: true };
    }
    if (type === 'search' && (u.finder_searches || 0) >= limits.searches) {
      return { allowed: false, reason: `Search limit reached (${limits.searches}/mo on ${plan} plan). Upgrade for more.`, upgrade: true };
    }
    if (type === 'campaign' && (u.campaigns_count || 0) >= limits.campaigns) {
      return { allowed: false, reason: `Campaign limit reached (${limits.campaigns} on ${plan} plan). Upgrade for more.`, upgrade: true };
    }
    return { allowed: true };
  } catch(e) {
    return { allowed: true }; // fail open
  }
}

async function incrementUsage(type, amount = 1) {
  const session = await getSession();
  if (!session) return;
  const month = new Date().toISOString().slice(0, 7);
  const field = {
    contact: 'contacts_count',
    sms: 'sms_sent',
    search: 'finder_searches',
    campaign: 'campaigns_count',
  }[type];
  if (!field) return;

  try {
    // Upsert usage row
    await sbFetch('usage', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: session.userId,
        month,
        [field]: amount,
      }),
    });
  } catch(e) {
    // Try increment via RPC if upsert fails
    console.warn('incrementUsage failed:', e);
  }
}

// ── CONTACTS ──────────────────────────────────────────────
async function loadContactsFromDB() {
  const session = await getSession();
  if (!session) return [];
  try {
    const rows = await sbFetch(`contacts?user_id=eq.${session.userId}&order=created_at.desc&select=*`);
    return rows || [];
  } catch(e) {
    console.error('loadContacts error:', e);
    return JSON.parse(localStorage.getItem('norx-contacts') || '[]');
  }
}

async function saveContactToDB(contact) {
  const session = await getSession();
  if (!session) return contact;
  try {
    const row = {
      user_id: session.userId,
      name: contact.name,
      industry: contact.industry || '',
      phone: contact.phone || '',
      email: contact.email || '',
      website: contact.website || '',
      status: contact.status || 'Saved',
      notes: contact.notes || '',
      callback_note: contact.callbackNote || '',
      sms_sent: contact.smsSent || 0,
      last_contact: contact.lastContact || null,
    };
    if (contact.dbId) {
      await sbFetch(`contacts?id=eq.${contact.dbId}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(row),
      });
      return contact;
    } else {
      const result = await sbFetch('contacts', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      return { ...contact, dbId: result?.[0]?.id };
    }
  } catch(e) {
    console.error('saveContact error:', e);
    return contact;
  }
}

async function deleteContactFromDB(dbId) {
  if (!dbId) return;
  const session = await getSession();
  if (!session) return;
  await sbFetch(`contacts?id=eq.${dbId}&user_id=eq.${session.userId}`, {
    method: 'DELETE',
  });
}

async function bulkSaveContactsToDB(contactsList) {
  const session = await getSession();
  if (!session) return;
  const rows = contactsList.map(c => ({
    user_id: session.userId,
    name: c.name,
    industry: c.industry || '',
    phone: c.phone || '',
    email: c.email || '',
    website: c.website || '',
    status: c.status || 'Saved',
    notes: c.notes || '',
    callback_note: c.callbackNote || '',
    sms_sent: c.smsSent || 0,
  }));
  // Batch in chunks of 50
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    await sbFetch('contacts', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    }).catch(e => console.error('bulk save error:', e));
  }
}

// ── CAMPAIGNS ─────────────────────────────────────────────
async function saveCampaignToDB(campaign) {
  const session = await getSession();
  if (!session) return campaign;
  try {
    const row = {
      user_id: session.userId,
      name: campaign.name,
      target: campaign.target,
      template_name: campaign.template,
      total: campaign.total || 0,
      sent: campaign.sent || 0,
      failed: campaign.failed || 0,
      status: campaign.status || 'sending',
      campaign_date: campaign.date || new Date().toLocaleDateString(),
    };
    if (campaign.dbId) {
      await sbFetch(`campaigns?id=eq.${campaign.dbId}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(row),
      });
    } else {
      const result = await sbFetch('campaigns', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      campaign.dbId = result?.[0]?.id;
    }
  } catch(e) {
    console.error('saveCampaign error:', e);
  }
  return campaign;
}

async function loadCampaignsFromDB() {
  const session = await getSession();
  if (!session) return [];
  try {
    const rows = await sbFetch(`campaigns?user_id=eq.${session.userId}&order=created_at.desc&select=*`);
    return (rows || []).map(r => ({
      id: r.id, dbId: r.id,
      name: r.name, target: r.target,
      template: r.template_name,
      total: r.total, sent: r.sent, failed: r.failed,
      status: r.status, date: r.campaign_date,
    }));
  } catch(e) {
    return JSON.parse(localStorage.getItem('norx-campaigns') || '[]');
  }
}

// ── SETTINGS (stored in profile) ─────────────────────────
async function saveSettingsToDB(settings) {
  await updateProfile({ settings_json: JSON.stringify(settings) });
}

async function loadSettingsFromDB() {
  const profile = await getProfile();
  if (!profile?.settings_json) return null;
  try { return JSON.parse(profile.settings_json); } catch(e) { return null; }
}

// ── ACTIVITY LOG ──────────────────────────────────────────
async function logActivityToDB(text, type = 'accent') {
  const session = await getSession();
  if (!session) return;
  try {
    await sbFetch('activity_log', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        user_id: session.userId,
        type,
        description: text,
      }),
    });
  } catch(e) {}
}

async function loadActivityFromDB() {
  const session = await getSession();
  if (!session) return [];
  try {
    const rows = await sbFetch(`activity_log?user_id=eq.${session.userId}&order=created_at.desc&limit=100&select=*`);
    return (rows || []).map(r => ({
      text: r.description,
      type: r.type,
      time: new Date(r.created_at).toLocaleTimeString(),
      ts: new Date(r.created_at).getTime(),
    }));
  } catch(e) { return []; }
}

console.log('Norx AI DB layer loaded');
