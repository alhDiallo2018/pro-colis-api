// mobile/lib/screens/dashboard/super_admin_dashboard.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/models/parcel.dart';
import 'package:procolis/models/user.dart';
import 'package:procolis/screens/super-admin/garages_management_screen.dart';
import 'package:procolis/screens/super-admin/users_management_screen.dart';
import 'package:procolis/services/api_service.dart';

import '../../providers/auth_provider.dart';
import '../../providers/parcel_provider.dart';
import '../profile/profile_screen.dart';

// Provider pour les utilisateurs
final userProvider = StateNotifierProvider<UserNotifier, List<User>>((ref) {
  return UserNotifier();
});

class UserNotifier extends StateNotifier<List<User>> {
  UserNotifier() : super([]);
  final ApiService _apiService = ApiService();

  Future<void> loadUsers() async {
    try {
      final users = await _apiService.getAllUsersSuperAdmin();
      state = users;
    } catch (e) {
      debugPrint('Erreur chargement utilisateurs: $e');
    }
  }

  Future<void> loadDrivers() async {
    try {
      final drivers = await _apiService.getAllDriversSuperAdmin();
      state = drivers;
    } catch (e) {
      debugPrint('Erreur chargement chauffeurs: $e');
    }
  }

  Future<void> updateUserStatus(String userId, String status) async {
    try {
      final Map<String, dynamic> result = await _apiService.updateUserStatus(userId, status);
      // Vérifier si le résultat contient l'utilisateur mis à jour
      if (result['success'] == true && result['user'] != null) {
        final updatedUser = User.fromJson(result['user']);
        final index = state.indexWhere((u) => u.id == userId);
        if (index != -1) {
          final newState = List<User>.from(state);
          newState[index] = updatedUser;
          state = newState;
        }
      }
    } catch (e) {
      debugPrint('Erreur mise à jour statut: $e');
    }
  }
}

class SuperAdminDashboard extends ConsumerStatefulWidget {
  const SuperAdminDashboard({super.key});

  @override
  ConsumerState<SuperAdminDashboard> createState() => _SuperAdminDashboardState();
}

class _SuperAdminDashboardState extends ConsumerState<SuperAdminDashboard> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    Future.microtask(() {
      // Utiliser la méthode correcte du ParcelNotifier
      ref.read(parcelProvider.notifier).loadAllParcels();
      ref.read(userProvider.notifier).loadUsers();
    });
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final parcelState = ref.watch(parcelProvider);
    final users = ref.watch(userProvider);

    return Scaffold(
      body: _getScreen(_selectedIndex, user, parcelState, users),
      bottomNavigationBar: BottomNavigationBar(
        type: BottomNavigationBarType.fixed,
        currentIndex: _selectedIndex,
        onTap: (index) => setState(() => _selectedIndex = index),
        selectedItemColor: const Color(0xFF0B6E3A),
        unselectedItemColor: Colors.grey,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.dashboard), label: 'Dashboard'),
          BottomNavigationBarItem(icon: Icon(Icons.people), label: 'Utilisateurs'),
          BottomNavigationBarItem(icon: Icon(Icons.business), label: 'Garages'),
          BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profil'),
        ],
      ),
    );
  }

  Widget _getScreen(int index, User? user, ParcelState parcelState, List<User> users) {
    switch (index) {
      case 0:
        return _SuperAdminHomeScreen(
          user: user,
          parcelState: parcelState,
          users: users,
          onRefresh: _loadData,
        );
      case 1:
        return const UsersManagementScreen();
      case 2:
        return const GaragesManagementScreen();
      case 3:
        return const ProfileScreen();
      default:
        return _SuperAdminHomeScreen(
          user: user,
          parcelState: parcelState,
          users: users,
          onRefresh: _loadData,
        );
    }
  }
}

class _SuperAdminHomeScreen extends StatelessWidget {
  final User? user;
  final ParcelState parcelState;
  final List<User> users;
  final VoidCallback onRefresh;

  const _SuperAdminHomeScreen({
    required this.user,
    required this.parcelState,
    required this.users,
    required this.onRefresh,
  });

  int get _totalParcels => parcelState.parcels.length;
  int get _pendingParcels => parcelState.parcels.where((p) => p.status == ParcelStatus.pending).length;
  int get _inTransitParcels => parcelState.parcels.where((p) => p.isInProgress).length;
  int get _deliveredParcels => parcelState.parcels.where((p) => p.isDelivered).length;
  
  int get _totalUsers => users.length;
  int get _totalDrivers => users.where((u) => u.isDriver).length;
  int get _totalAdmins => users.where((u) => u.isAdmin).length;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      child: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 180,
            floating: true,
            pinned: true,
            backgroundColor: const Color(0xFF0B6E3A),
            flexibleSpace: FlexibleSpaceBar(
              title: Text(
                'Admin ${user?.fullName.split(' ').first ?? "Super"}',
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
                          'Administration',
                          style: TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Gérez l\'ensemble de la plateforme',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.white.withAlpha(200),
                          ),
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
                _buildStatsSection(),
                const SizedBox(height: 24),
                _buildQuickActions(context),
                const SizedBox(height: 24),
                _buildRecentActivitySection(),
                const SizedBox(height: 80),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Statistiques globales',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.5,
          children: [
            _StatCardLarge(
              title: 'Colis',
              value: _totalParcels.toString(),
              icon: Icons.inventory,
              color: Colors.blue,
            ),
            _StatCardLarge(
              title: 'Utilisateurs',
              value: _totalUsers.toString(),
              icon: Icons.people,
              color: Colors.green,
            ),
            _StatCardLarge(
              title: 'Chauffeurs',
              value: _totalDrivers.toString(),
              icon: Icons.delivery_dining,
              color: Colors.orange,
            ),
            _StatCardLarge(
              title: 'Admins',
              value: _totalAdmins.toString(),
              icon: Icons.admin_panel_settings,
              color: Colors.purple,
            ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            _StatCardSmall(
              title: 'En attente',
              value: _pendingParcels.toString(),
              color: Colors.orange,
            ),
            const SizedBox(width: 12),
            _StatCardSmall(
              title: 'En cours',
              value: _inTransitParcels.toString(),
              color: Colors.blue,
            ),
            const SizedBox(width: 12),
            _StatCardSmall(
              title: 'Livrés',
              value: _deliveredParcels.toString(),
              color: Colors.green,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildQuickActions(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Actions rapides',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _ActionCard(
                icon: Icons.business,
                label: 'Garages',
                color: const Color(0xFF0B6E3A),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const GaragesManagementScreen()),
                  );
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ActionCard(
                icon: Icons.people,
                label: 'Utilisateurs',
                color: Colors.orange,
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const UsersManagementScreen()),
                  );
                },
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildRecentActivitySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Activité récente',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        if (parcelState.isLoading)
          const Center(child: CircularProgressIndicator())
        else if (parcelState.parcels.isEmpty)
          Container(
            padding: const EdgeInsets.all(40),
            alignment: Alignment.center,
            child: Text(
              'Aucune activité récente',
              style: TextStyle(color: Colors.grey.withAlpha(150)),
            ),
          )
        else
          ...parcelState.parcels.take(5).map((parcel) => ListTile(
            leading: CircleAvatar(
              backgroundColor: parcel.status.color.withAlpha(25),
              child: Icon(Icons.local_shipping, color: parcel.status.color, size: 20),
            ),
            title: Text(
              parcel.trackingNumber,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            subtitle: Text('${parcel.receiverName} - ${parcel.status.label}'),
            trailing: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: parcel.status.color.withAlpha(25),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                parcel.status.label,
                style: TextStyle(fontSize: 11, color: parcel.status.color),
              ),
            ),
          )),
      ],
    );
  }
}

class _StatCardLarge extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _StatCardLarge({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  title,
                  style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatCardSmall extends StatelessWidget {
  final String title;
  final String value;
  final Color color;

  const _StatCardSmall({
    required this.title,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color),
            ),
            const SizedBox(height: 4),
            Text(title, style: const TextStyle(fontSize: 11)),
          ],
        ),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionCard({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}