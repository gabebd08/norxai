-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  status TEXT DEFAULT 'Saved',
  notes TEXT DEFAULT '',
  callback_note TEXT DEFAULT '',
  sms_sent INTEGER DEFAULT 0,
  last_contact TEXT DEFAULT '—',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  target TEXT DEFAULT 'Saved',
  template_name TEXT DEFAULT '',
  total INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  status TEXT DEFAULT 'sending',
  campaign_date TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  message TEXT NOT NULL,
  twilio_sid TEXT DEFAULT '',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add settings_json to profiles if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS settings_json TEXT DEFAULT '';

-- RLS policies for new tables
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own contacts" ON contacts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own campaigns" ON campaigns FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own templates" ON templates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own conversations" ON conversations FOR ALL USING (auth.uid() = user_id);

-- Index for performance
CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts(user_id);
CREATE INDEX IF NOT EXISTS campaigns_user_id_idx ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS conversations_contact_id_idx ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS activity_log_user_id_idx ON activity_log(user_id);
