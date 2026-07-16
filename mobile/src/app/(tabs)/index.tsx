import { StyleSheet, Text, View, FlatList, Image, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import React, { useEffect, useState } from 'react';
import { getCategoryList } from '../../api';

export default function HomeScreen() {
  const [movies, setMovies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHomeData();
  }, []);

  const loadHomeData = async () => {
    try {
      // Fetch Hindi Dubbed for Home tab (tabId "0")
      const data = await getCategoryList("0", 1, 20, { classify: 'Hindi dub' });
      const validItems = (data || []).filter((item: any) => {
        const hasCover = item.cover && (item.cover.url || typeof item.cover === 'string');
        return hasCover && (item.subjectType === 1 || item.subjectType === 2 || !item.subjectType);
      });
      setMovies(validItems);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const heroMovie = movies.length > 0 ? movies[0] : null;
  const trendingList = movies.slice(1);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#e50914" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {heroMovie && (
        <View style={styles.heroContainer}>
          <Image 
            source={{ uri: heroMovie.cover?.url || heroMovie.cover }} 
            style={styles.heroImage} 
            resizeMode="cover"
          />
          <View style={styles.heroGradient} />
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>{heroMovie.title}</Text>
            <View style={styles.heroButtons}>
              <TouchableOpacity style={styles.playButton}>
                <Text style={styles.playButtonText}>▶ Play</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.infoButton}>
                <Text style={styles.infoButtonText}>ℹ Info</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trending Hindi Dubbed</Text>
        <FlatList
          horizontal
          data={trendingList}
          keyExtractor={(item, index) => item.id ? String(item.id) : String(index)}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card}>
              <Image source={{ uri: item.cover?.url || item.cover }} style={styles.cardImage} />
            </TouchableOpacity>
          )}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  heroContainer: {
    height: 500,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
    backgroundColor: 'rgba(0,0,0,0.7)', 
  },
  heroContent: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 10,
  },
  heroButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  playButton: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 4,
  },
  playButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoButton: {
    backgroundColor: 'rgba(109, 109, 110, 0.7)',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 4,
  },
  infoButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  section: {
    marginTop: 20,
    paddingLeft: 20,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  card: {
    width: 120,
    marginRight: 12,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 2/3,
    borderRadius: 6,
  },
});
