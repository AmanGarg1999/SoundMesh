import axios from 'axios';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

export class YouTubeHandler {
  constructor() {
    this.youtube = google.youtube('v3');
  }

  /**
   * Search for videos using the API Key
   */
  async search(query) {
    if (!API_KEY) {
      throw new Error('YOUTUBE_API_KEY is not set in the .env file.');
    }

    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          maxResults: 20,
          q: query,
          type: 'video',
          key: API_KEY,
        },
      });

      return response.data.items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        channel: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
      }));
    } catch (err) {
      console.error('[YouTubeHandler] Search failed:', err.response?.data || err.message);
      throw new Error('YouTube search failed');
    }
  }

  /**
   * Get metadata for a specific video
   */
  async getVideoMetadata(videoId) {
    if (!API_KEY) {
      throw new Error('YOUTUBE_API_KEY is not set in the .env file.');
    }

    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'snippet,contentDetails,statistics',
          id: videoId,
          key: API_KEY,
        },
      });

      const item = response.data.items[0];
      if (!item) throw new Error('Video not found');

      return {
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration,
        viewCount: item.statistics.viewCount,
      };
    } catch (err) {
      console.error('[YouTubeHandler] Metadata fetch failed:', err.message);
      throw err;
    }
  }

  /**
   * Get OAuth URL for user login
   */
  getAuthUrl() {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not set in .env');
    }

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.readonly'],
      prompt: 'consent',
    });
  }

  /**
   * Exchange code for tokens
   */
  async handleCallback(code) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  /**
   * Get personal playlists using OAuth token
   */
  async getPersonalPlaylists(accessToken) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    try {
      const response = await this.youtube.playlists.list({
        auth,
        part: 'snippet,contentDetails',
        mine: true,
        maxResults: 50,
      });

      return response.data.items.map(item => ({
        id: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.default.url,
        itemCount: item.contentDetails.itemCount,
      }));
    } catch (err) {
      console.error('[YouTubeHandler] Failed to fetch playlists:', err.message);
      throw err;
    }
  }

  /**
   * Get items from a specific playlist
   */
  async getPlaylistItems(playlistId, accessToken = null) {
    const params = {
      part: 'snippet,contentDetails',
      playlistId: playlistId,
      maxResults: 50,
    };

    if (accessToken) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      params.auth = auth;
    } else {
      params.key = API_KEY;
    }

    try {
      const response = await this.youtube.playlistItems.list(params);
      return response.data.items.map(item => ({
        id: item.contentDetails.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.default.url,
        position: item.snippet.position,
      }));
    } catch (err) {
      console.error('[YouTubeHandler] Failed to fetch playlist items:', err.message);
      throw err;
    }
  }
}

export const youtubeHandler = new YouTubeHandler();
