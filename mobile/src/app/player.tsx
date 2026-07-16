import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getResourceLinks, getPlayInfo } from '../api';

export default function PlayerScreen() {
  const { id, title } = useLocalSearchParams();
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadVideo();
    }
  }, [id]);

  const loadVideo = async () => {
    try {
      // 1. Get episode list to find the first episode
      const resources = await getResourceLinks(id as string, '1', 1, '0');
      if (resources && resources.list && resources.list.length > 0) {
        const episode = resources.list[0];
        
        // 2. Fetch the actual playback URL (M3U8 / DASH)
        const playInfo = await getPlayInfo(id as string, episode.id);
        
        // Use the highest quality available, default to first url
        if (playInfo?.data?.playUrls) {
          const urls = playInfo.data.playUrls;
          const bestUrl = urls.find((u:any) => u.resolution === '1080P' || u.resolution === '720P') || urls[0];
          if (bestUrl) {
             setVideoUrl(bestUrl.url);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const player = useVideoPlayer(videoUrl, player => {
    player.loop = false;
    player.play();
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>✕ Close</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>

      <View style={styles.playerContainer}>
        {loading ? (
           <ActivityIndicator size="large" color="#e50914" />
        ) : videoUrl ? (
           <VideoView
             player={player}
             style={styles.video}
             allowsFullscreen
             allowsPictureInPicture
           />
        ) : (
           <Text style={styles.errorText}>Video not available.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#111',
  },
  backButton: {
    marginRight: 16,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  playerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  errorText: {
    color: '#fff',
  }
});
