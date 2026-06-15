/**
 * Mango × QVAC — Error boundary
 * Catches native module crashes and displays a fallback UI.
 */
import React, { Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
  theme?: { bg: string; textPrimary: string; destructive: string; accent: string };
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const t = this.props.theme || { bg: '#1A1A1A', textPrimary: '#F5F5F5', destructive: '#F87171', accent: '#4D9EFF' };
      return (
        <View style={[es.root, { backgroundColor: t.bg }]}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: t.textPrimary, marginBottom: 16 }}>Something went wrong</Text>
          <Text style={{ fontSize: 13, color: t.destructive, marginBottom: 16, textAlign: 'center', paddingHorizontal: 32 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity onPress={this.handleReload} style={{ backgroundColor: t.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const es = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
});
