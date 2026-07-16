import { StyleSheet, Text, View, FlatList, Image, TouchableOpacity } from 'react-native';
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

export default function WatchlistScreen() {
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    loadWatchlist();
  }, []);

  const loadWatchlist = async () => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_watchlist');
      if (stored) {
        setWatchlist(JSON.parse(stored));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.card}
      onPress={() => router.push({ pathname: '/details/[id]', params: { id: item.id } })}
    >
      <Image source={{ uri: item.cover }} style={styles.image} />
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {watchlist.length === 0 ? (
        <Text style={styles.emptyText}>Your watchlist is empty.</Text>
      ) : (
        <FlatList
          data={watchlist}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          numColumns={3}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 16,
  },
  list: {
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'flex-start',
    gap: 12,
  },
  card: {
    width: '31%',
    marginBottom: 16,
  },
  image: {
    width: '100%',
    aspectRatio: 2/3,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  title: {
    color: '#fff',
    fontSize: 12,
    marginTop: 8,
  },
  emptyText: {
    color: '#aaa',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  }
});
