import { StyleSheet, Text, View, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { getSubjectDetails, getResourceLinks } from '../../api';

export default function DetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [inWatchlist, setInWatchlist] = useState(false);

  useEffect(() => {
    if (id) {
      loadDetails();
    }
  }, [id]);

  const loadDetails = async () => {
    try {
      const data = await getSubjectDetails(id as string, '1');
      setDetails(data);
      checkWatchlist(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const checkWatchlist = async (movieData: any) => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_watchlist');
      if (stored) {
        const list = JSON.parse(stored);
        if (list.find((item: any) => item.id === movieData.id)) {
          setInWatchlist(true);
        }
      }
    } catch (e) {}
  };

  const toggleWatchlist = async () => {
    if (!details) return;
    try {
      const stored = await AsyncStorage.getItem('popcorn_watchlist');
      let list = stored ? JSON.parse(stored) : [];
      if (inWatchlist) {
        list = list.filter((item: any) => item.id !== details.id);
      } else {
        list.push({ id: details.id, title: details.title, cover: details.cover?.url || details.cover });
      }
      await AsyncStorage.setItem('popcorn_watchlist', JSON.stringify(list));
      setInWatchlist(!inWatchlist);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePlay = async () => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_history');
      let history = stored ? JSON.parse(stored) : [];
      // Remove if exists to put it at the top
      history = history.filter((item: any) => item.id !== details.id);
      history.unshift({ id: details.id, title: details.title, cover: details.cover?.url || details.cover });
      if (history.length > 50) history.pop();
      await AsyncStorage.setItem('popcorn_history', JSON.stringify(history));
    } catch (e) {
      console.error(e);
    }
    router.push({ pathname: '/player', params: { id, title: details.title } });
  };

  const handleDownload = async () => {
    try {
      const resources = await getResourceLinks(id as string, '1', 1, '0');
      if (resources && resources.list && resources.list.length > 0) {
         Linking.openURL(`https://popcorn-movies-example.vercel.app/movie/${id}`); // Placeholder for web redirect to circumvent HLS limitations
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#e50914" />
      </View>
    );
  }

  if (!details) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to load details.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Image 
        source={{ uri: details.cover?.url || details.cover }} 
        style={styles.heroImage} 
      />
      <View style={styles.content}>
        <Text style={styles.title}>{details.title}</Text>
        <Text style={styles.meta}>{details.year} • {details.areaList?.map((a:any)=>a.name).join(', ')}</Text>
        
        <TouchableOpacity 
          style={styles.playButton}
          onPress={handlePlay}
        >
          <Text style={styles.playButtonText}>▶ Play Now</Text>
        </TouchableOpacity>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={toggleWatchlist}>
            <Ionicons name={inWatchlist ? "checkmark" : "add"} size={28} color="#fff" />
            <Text style={styles.actionText}>My List</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn}>
            <Ionicons name="thumbs-up-outline" size={28} color="#fff" />
            <Text style={styles.actionText}>Rate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDownload}>
            <Ionicons name="download-outline" size={28} color="#fff" />
            <Text style={styles.actionText}>Download</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.description} numberOfLines={4}>
          {details.brief}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  heroImage: {
    width: '100%',
    aspectRatio: 16/9,
    backgroundColor: '#222',
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  meta: {
    color: '#aaa',
    fontSize: 14,
    marginBottom: 20,
  },
  playButton: {
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 4,
    alignItems: 'center',
    marginBottom: 24,
  },
  playButtonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    color: '#aaa',
    fontSize: 12,
  },
  description: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
  },
  errorText: {
    color: '#fff',
    textAlign: 'center',
    marginTop: 40,
  }
});
