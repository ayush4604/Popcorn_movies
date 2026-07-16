import { StyleSheet, Text, View, TextInput, FlatList, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import React, { useState } from 'react';
import { searchMovies } from '../../api';

export default function ExploreScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchMovies(text, 1, 20);
      setResults(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const imageUrl = item.cover?.url || (typeof item.cover === 'string' ? item.cover : null);
    if (!imageUrl) return null;

    return (
      <TouchableOpacity style={styles.card}>
        <Image source={{ uri: imageUrl }} style={styles.image} />
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Search</Text>
      <TextInput
        style={styles.searchInput}
        placeholder="Search for movies, tv shows, anime..."
        placeholderTextColor="#888"
        value={query}
        onChangeText={handleSearch}
      />
      {loading ? (
        <ActivityIndicator size="large" color="#e50914" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item, index) => item.id ? String(item.id) : String(index)}
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
    paddingTop: 60,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: '#1e1e1e',
    color: '#ffffff',
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
  },
  list: {
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'space-between',
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
});
