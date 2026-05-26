export interface SongData {
  title: string;
  artist: string;
  originalKey: string;
  suggestedTempo: number;
  strummingPattern?: string;
  sections: {
    name: string;
    lines: string[];
  }[];
}

export interface LibrarySong extends SongData {
  id: string;
}

export interface UserProfile {
  favoritesCount: number;
  printCount: number;
  isSubscribed: boolean;
  subscriptionType?: 'monthly' | 'yearly' | 'lifetime';
  renewalDate?: any;
  displayName?: string;
  email?: string;
  country?: string;
  updatedAt: any;
}
