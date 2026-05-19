// mobile/lib/screens/dashboard/client_dashboard.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/models/parcel.dart';
import 'package:procolis/models/user.dart';

import '../../providers/auth_provider.dart';
import '../../providers/parcel_provider.dart';
import '../../widgets/parcel_card.dart';
import '../parcel/new_parcel_screen.dart';
import '../parcel/track_parcel_screen.dart';
import '../profile/profile_screen.dart';

class ClientDashboard extends ConsumerStatefulWidget {
  const ClientDashboard({super.key});

  @override
  ConsumerState<ClientDashboard> createState() => _ClientDashboardState();
}

class _ClientDashboardState extends ConsumerState<ClientDashboard> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    Future.microtask(() {
      ref.read(parcelProvider.notifier).loadMyParcels();
    });
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final parcelState = ref.watch(parcelProvider);

    return Scaffold(
      body: _getScreen(_selectedIndex, user, parcelState),
      bottomNavigationBar: BottomNavigationBar(
        type: BottomNavigationBarType.fixed,
        currentIndex: _selectedIndex,
        onTap: (index) => setState(() => _selectedIndex = index),
        selectedItemColor: const Color(0xFF0B6E3A),
        unselectedItemColor: Colors.grey,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Accueil'),
          BottomNavigationBarItem(icon: Icon(Icons.add_box), label: 'Envoyer'),
          BottomNavigationBarItem(icon: Icon(Icons.search), label: 'Suivre'),
          BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profil'),
        ],
      ),
    );
  }

  Widget _getScreen(int index, User? user, ParcelState parcelState) {
    switch (index) {
      case 0:
        return _HomeScreen(user: user, parcelState: parcelState, onRefresh: _loadData);
      case 1:
        return const NewParcelScreen();
      case 2:
        return const TrackParcelScreen();
      case 3:
        return const ProfileScreen();
      default:
        return _HomeScreen(user: user, parcelState: parcelState, onRefresh: _loadData);
    }
  }
}

class _HomeScreen extends StatelessWidget {
  final User? user;
  final ParcelState parcelState;
  final VoidCallback onRefresh;

  const _HomeScreen({
    required this.user,
    required this.parcelState,
    required this.onRefresh,
  });

  int get _pendingCount => parcelState.parcels.where((p) => p.status == ParcelStatus.pending).length;
  int get _inProgressCount => parcelState.parcels.where((p) => p.isInProgress).length;
  int get _deliveredCount => parcelState.parcels.where((p) => p.isDelivered).length;

  void _onParcelTap(Parcel parcel) {
    // Navigation vers les détails du colis
    // À implémenter selon vos besoins
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      child: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 220,
            floating: true,
            pinned: true,
            backgroundColor: const Color(0xFF0B6E3A),
            flexibleSpace: FlexibleSpaceBar(
              title: Text(
                'Bonjour ${user?.fullName.split(' ').first ?? "Client"}',
                style: const TextStyle(fontSize: 16),
              ),
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF0B6E3A), Color(0xFF168A48)],
                  ),
                ),
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Spacer(),
                        const Text(
                          'PRO COLIS',
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                            letterSpacing: 2,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Transport de colis en Afrique',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.white.withAlpha(200),
                          ),
                        ),
                        const SizedBox(height: 16),
                        // Quick action buttons
                        Row(
                          children: [
                            _buildQuickAction(
                              icon: Icons.add_box,
                              label: 'Envoyer',
                              color: Colors.white,
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (context) => const NewParcelScreen()),
                                );
                              },
                            ),
                            const SizedBox(width: 16),
                            _buildQuickAction(
                              icon: Icons.search,
                              label: 'Suivre',
                              color: Colors.white,
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (context) => const TrackParcelScreen()),
                                );
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                // Statistiques
                _buildStatsSection(),
                const SizedBox(height: 24),
                
                // Derniers colis
                _buildRecentParcelsSection(context),
                const SizedBox(height: 80),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickAction({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          border: Border.all(color: Colors.white.withAlpha(100)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(color: color, fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsSection() {
    return Row(
      children: [
        _StatCard(
          title: 'En attente',
          value: _pendingCount.toString(),
          color: Colors.orange,
          icon: Icons.pending,
        ),
        const SizedBox(width: 12),
        _StatCard(
          title: 'En cours',
          value: _inProgressCount.toString(),
          color: Colors.blue,
          icon: Icons.local_shipping,
        ),
        const SizedBox(width: 12),
        _StatCard(
          title: 'Livrés',
          value: _deliveredCount.toString(),
          color: Colors.green,
          icon: Icons.check_circle,
        ),
      ],
    );
  }

  Widget _buildRecentParcelsSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Derniers colis',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            if (parcelState.parcels.isNotEmpty)
              TextButton(
                onPressed: () {
                  // Naviguer vers la liste complète
                },
                child: const Text('Voir tout'),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (parcelState.isLoading)
          const Center(child: CircularProgressIndicator())
        else if (parcelState.parcels.isEmpty)
          Container(
            padding: const EdgeInsets.all(40),
            decoration: BoxDecoration(
              color: Colors.grey.withAlpha(20),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                Icon(Icons.inbox, size: 48, color: Colors.grey.withAlpha(150)),
                const SizedBox(height: 12),
                Text(
                  'Aucun colis pour le moment',
                  style: TextStyle(color: Colors.grey.withAlpha(150)),
                ),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (context) => const NewParcelScreen()),
                    );
                  },
                  icon: const Icon(Icons.add),
                  label: const Text('Envoyer un colis'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0B6E3A),
                  ),
                ),
              ],
            ),
          )
        else
          ...parcelState.parcels.take(5).map((parcel) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: ParcelCard(
              parcel: parcel,
              onTap: () => _onParcelTap(parcel),
            ),
          )),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final String value;
  final Color color;
  final IconData icon;

  const _StatCard({
    required this.title,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    value,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    title,
                    style: const TextStyle(fontSize: 11),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}