import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/screens/super-admin/garage_form_screen.dart';
import 'package:procolis/screens/super-admin/parcel_form_screen.dart';
import 'package:procolis/screens/super-admin/reports_bottom_sheet.dart';
import 'package:procolis/screens/super-admin/user_form_screen.dart';

import '../../models/garage.dart';
import '../../models/parcel.dart';
import '../../models/user.dart';
import '../../services/api_service.dart';

class AdminDashboardFull extends ConsumerStatefulWidget {
  const AdminDashboardFull({super.key});

  @override
  ConsumerState<AdminDashboardFull> createState() => _AdminDashboardFullState();
}

class _AdminDashboardFullState extends ConsumerState<AdminDashboardFull> {
  final ApiService _apiService = ApiService();
  List<User> _users = [];
  List<Parcel> _parcels = [];
  List<Garage> _garages = [];
  bool _isLoading = true;
  String? _error;
  String _selectedPeriod = 'month';

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final users = await _apiService.getAllUsersSuperAdmin();
      final parcels = await _apiService.getAllParcelsSuperAdmin();
      final garages = await _apiService.getAllGaragesSuperAdmin();

      setState(() {
        _users = users;
        _parcels = parcels;
        _garages = garages;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _refreshData() async {
    await _loadData();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey.shade100,
      body: RefreshIndicator(
        onRefresh: _refreshData,
        child: CustomScrollView(
          slivers: [
            // AppBar avec en-tête
            SliverAppBar(
              expandedHeight: 200,
              pinned: true,
              backgroundColor: const Color(0xFF0B6E3A),
              flexibleSpace: FlexibleSpaceBar(
                title: const Text('Tableau de bord', style: TextStyle(color: Colors.white)),
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
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'PRO COLIS',
                            style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Bienvenue sur votre espace d\'administration',
                            style: TextStyle(color: Colors.white.withAlpha(200)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            
            if (_isLoading)
              const SliverFillRemaining(
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              SliverFillRemaining(
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 64, color: Colors.red),
                      const SizedBox(height: 16),
                      Text('Erreur: $_error'),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        child: const Text('Réessayer'),
                      ),
                    ],
                  ),
                ),
              )
            else
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          _DashboardCard(
                            title: 'Utilisateurs',
                            value: _users.length.toString(),
                            icon: Icons.people,
                            color: Colors.blue,
                            subtitle: 'Total inscrits',
                            onTap: () => _viewUsersSection(_users),
                          ),
                          const SizedBox(width: 12),
                          _DashboardCard(
                            title: 'Chauffeurs',
                            value: _users.where((u) => u.role == UserRole.driver).length.toString(),
                            icon: Icons.delivery_dining,
                            color: Colors.green,
                            subtitle: 'Chauffeurs enregistrés',
                            onTap: () => _viewDriversSection(_users),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          _DashboardCard(
                            title: 'Colis',
                            value: _parcels.length.toString(),
                            icon: Icons.inventory,
                            color: Colors.orange,
                            subtitle: '${_parcels.where((p) => p.status == ParcelStatus.delivered).length} livrés',
                            onTap: () => _viewParcelsSection(_parcels),
                          ),
                          const SizedBox(width: 12),
                          _DashboardCard(
                            title: 'Garages',
                            value: _garages.length.toString(),
                            icon: Icons.business,
                            color: Colors.purple,
                            subtitle: 'Partenaires',
                            onTap: () => _viewGaragesSection(_garages),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            
            // Statistiques détaillées
            if (!_isLoading && _error == null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                'Statistiques des colis',
                                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                              ),
                              DropdownButton<String>(
                                value: _selectedPeriod,
                                items: const [
                                  DropdownMenuItem(value: 'week', child: Text('Cette semaine')),
                                  DropdownMenuItem(value: 'month', child: Text('Ce mois')),
                                  DropdownMenuItem(value: 'year', child: Text('Cette année')),
                                ],
                                onChanged: (value) {
                                  if (value != null) {
                                    setState(() => _selectedPeriod = value);
                                    _loadData();
                                  }
                                },
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          _buildStatsTable(_parcels),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            
            // Tableau des dernières activités
            if (!_isLoading && _error == null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Dernières activités',
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 16),
                          ..._buildRecentActivities(),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            
            const SliverToBoxAdapter(child: SizedBox(height: 80)),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showQuickActions,
        backgroundColor: const Color(0xFF0B6E3A),
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  void _viewUsersSection(List<User> users) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        child: Container(
          width: double.maxFinite,
          height: MediaQuery.of(context).size.height * 0.8,
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Text(
                'Liste des utilisateurs',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.builder(
                  itemCount: users.length,
                  itemBuilder: (context, index) {
                    final user = users[index];
                    return ListTile(
                      title: Text(user.fullName),
                      subtitle: Text(user.email),
                      trailing: Chip(
                        label: Text(user.role.label),
                        backgroundColor: user.role.color.withAlpha(50),
                      ),
                      onTap: () => _viewUserDetails(user),
                    );
                  },
                ),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Fermer'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _viewDriversSection(List<User> users) {
    final drivers = users.where((u) => u.role == UserRole.driver).toList();
    showDialog(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        child: Container(
          width: double.maxFinite,
          height: MediaQuery.of(context).size.height * 0.8,
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Text(
                'Liste des chauffeurs',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.builder(
                  itemCount: drivers.length,
                  itemBuilder: (context, index) {
                    final driver = drivers[index];
                    return ListTile(
                      title: Text(driver.fullName),
                      subtitle: Text(driver.phone),
                      trailing: Chip(
                        label: Text(driver.status.label),
                        backgroundColor: driver.status == UserStatus.active ? Colors.green.withAlpha(50) : Colors.red.withAlpha(50),
                      ),
                      onTap: () => _viewUserDetails(driver),
                    );
                  },
                ),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Fermer'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _viewParcelsSection(List<Parcel> parcels) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        child: Container(
          width: double.maxFinite,
          height: MediaQuery.of(context).size.height * 0.8,
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Text(
                'Liste des colis',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.builder(
                  itemCount: parcels.length,
                  itemBuilder: (context, index) {
                    final parcel = parcels[index];
                    return ListTile(
                      title: Text(parcel.trackingNumber),
                      subtitle: Text(parcel.receiverName),
                      trailing: Chip(
                        label: Text(parcel.status.label),
                        backgroundColor: parcel.status.color.withAlpha(50),
                      ),
                      onTap: () => _viewParcelDetails(parcel),
                    );
                  },
                ),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Fermer'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _viewGaragesSection(List<Garage> garages) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        child: Container(
          width: double.maxFinite,
          height: MediaQuery.of(context).size.height * 0.8,
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Text(
                'Liste des garages',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.builder(
                  itemCount: garages.length,
                  itemBuilder: (context, index) {
                    final garage = garages[index];
                    return ListTile(
                      title: Text(garage.name),
                      subtitle: Text('${garage.city}, ${garage.region}'),
                      trailing: Text('${garage.driversCount} chauffeurs'),
                      onTap: () => _viewGarageDetails(garage),
                    );
                  },
                ),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Fermer'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatsTable(List<Parcel> parcels) {
    final statusCount = {
      'En attente': parcels.where((p) => p.status == ParcelStatus.pending).length,
      'Confirmés': parcels.where((p) => p.status == ParcelStatus.confirmed).length,
      'Ramassés': parcels.where((p) => p.status == ParcelStatus.pickedUp).length,
      'En transit': parcels.where((p) => p.status == ParcelStatus.inTransit).length,
      'Arrivés': parcels.where((p) => p.status == ParcelStatus.arrived).length,
      'En livraison': parcels.where((p) => p.status == ParcelStatus.outForDelivery).length,
      'Livrés': parcels.where((p) => p.status == ParcelStatus.delivered).length,
      'Annulés': parcels.where((p) => p.status == ParcelStatus.cancelled).length,
    };

    return Column(
      children: statusCount.entries.map((entry) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            SizedBox(width: 100, child: Text(entry.key)),
            Expanded(
              flex: 2,
              child: LinearProgressIndicator(
                value: parcels.isEmpty ? 0 : entry.value / parcels.length,
                backgroundColor: Colors.grey.shade200,
                color: _getStatusColor(entry.key),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 40,
              child: Text(
                entry.value.toString(),
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      )).toList(),
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'Livrés':
        return Colors.green;
      case 'En transit':
      case 'En livraison':
        return Colors.orange;
      case 'Annulés':
        return Colors.red;
      default:
        return Colors.blue;
    }
  }

  List<Widget> _buildRecentActivities() {
    final activities = <Widget>[];
    
    // Derniers utilisateurs inscrits (5 premiers)
    final recentUsers = _users.reversed.take(5).toList();
    if (recentUsers.isNotEmpty) {
      activities.add(const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Text('Nouveaux utilisateurs', style: TextStyle(fontWeight: FontWeight.bold)),
      ));
      
      for (var user in recentUsers) {
        activities.add(
          ListTile(
            leading: CircleAvatar(
              backgroundColor: user.role.color.withAlpha(50),
              child: Icon(user.role.icon, color: user.role.color),
            ),
            title: Text(user.fullName),
            subtitle: Text('${user.role.label} - ${_formatDate(user.createdAt)}'),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _viewUserDetails(user),
          ),
        );
        activities.add(const Divider());
      }
    }
    
    // Derniers colis (5 premiers)
    final recentParcels = _parcels.reversed.take(5).toList();
    if (recentParcels.isNotEmpty) {
      activities.add(const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Text('Derniers colis', style: TextStyle(fontWeight: FontWeight.bold)),
      ));
      
      for (var parcel in recentParcels) {
        activities.add(
          ListTile(
            leading: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: parcel.status.color.withAlpha(50),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(Icons.local_shipping, color: parcel.status.color),
            ),
            title: Text(parcel.trackingNumber),
            subtitle: Text('${parcel.receiverName} - ${parcel.status.label}'),
            trailing: Text(
              _formatDate(parcel.createdAt),
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
            onTap: () => _viewParcelDetails(parcel),
          ),
        );
        activities.add(const Divider());
      }
    }
    
    return activities;
  }

  void _showQuickActions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 20),
            ListTile(
              leading: const Icon(Icons.person_add, color: Color(0xFF0B6E3A)),
              title: const Text('Ajouter un utilisateur'),
              onTap: () {
                Navigator.pop(context);
                _createUser();
              },
            ),
            ListTile(
              leading: const Icon(Icons.add_business, color: Color(0xFF0B6E3A)),
              title: const Text('Ajouter un garage'),
              onTap: () {
                Navigator.pop(context);
                _createGarage();
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_shipping, color: Color(0xFF0B6E3A)),
              title: const Text('Créer un colis'),
              onTap: () {
                Navigator.pop(context);
                _createParcel();
              },
            ),
            ListTile(
              leading: const Icon(Icons.payments, color: Color(0xFF0B6E3A)),
              title: const Text('Voir les rapports'),
              onTap: () {
                Navigator.pop(context);
                _showReports();
              },
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _viewUserDetails(User user) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(user.fullName),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _DetailRow(label: 'Email', value: user.email),
              _DetailRow(label: 'Téléphone', value: user.phone),
              _DetailRow(label: 'Rôle', value: user.role.label),
              _DetailRow(label: 'Statut', value: user.status.label),
              if (user.address != null && user.address!.isNotEmpty) 
                _DetailRow(label: 'Adresse', value: user.address!),
              if (user.city != null && user.city!.isNotEmpty) 
                _DetailRow(label: 'Ville', value: user.city!),
              if (user.region != null && user.region!.isNotEmpty) 
                _DetailRow(label: 'Région', value: user.region!),
              _DetailRow(label: 'Inscription', value: _formatDate(user.createdAt)),
              if (user.lastLogin != null) 
                _DetailRow(label: 'Dernière connexion', value: _formatDate(user.lastLogin!)),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Fermer'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              _editUser(user);
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0B6E3A)),
            child: const Text('Modifier'),
          ),
        ],
      ),
    );
  }

  void _viewParcelDetails(Parcel parcel) {
  showDialog(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(parcel.trackingNumber),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _DetailRow(label: 'Expéditeur', value: parcel.senderName),
            _DetailRow(label: 'Destinataire', value: parcel.receiverName),
            _DetailRow(label: 'Téléphone', value: parcel.receiverPhone),
            if (parcel.receiverEmail != null && parcel.receiverEmail!.isNotEmpty)
              _DetailRow(label: 'Email', value: parcel.receiverEmail!),
            _DetailRow(label: 'Description', value: parcel.description),
            _DetailRow(label: 'Poids', value: '${parcel.weight} kg'),
            _DetailRow(label: 'Type', value: parcel.type.label),
            _DetailRow(label: 'Statut', value: parcel.status.label),
            if (parcel.price != null) 
              _DetailRow(label: 'Prix', value: '${parcel.price!.toInt()} FCFA'),
            if (parcel.departureGarageName.isNotEmpty == true)
              _DetailRow(label: 'Départ', value: parcel.departureGarageName),
            if (parcel.arrivalGarageName != null && parcel.arrivalGarageName!.isNotEmpty)
              _DetailRow(label: 'Arrivée', value: parcel.arrivalGarageName!),
            if (parcel.driverName != null && parcel.driverName!.isNotEmpty)
              _DetailRow(label: 'Chauffeur', value: parcel.driverName!),
            _DetailRow(label: 'Créé le', value: _formatDate(parcel.createdAt)),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Fermer'),
        ),
      ],
    ),
  );
}
  void _viewGarageDetails(Garage garage) {
  showDialog(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(garage.name),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _DetailRow(label: 'Ville', value: garage.city),
            _DetailRow(label: 'Région', value: garage.region),
            if (garage.address != null && garage.address!.isNotEmpty)
              _DetailRow(label: 'Adresse', value: garage.address!),
            if (garage.phone != null && garage.phone!.isNotEmpty)
              _DetailRow(label: 'Téléphone', value: garage.phone!),
            _DetailRow(label: 'Nombre de chauffeurs', value: garage.driversCount.toString()),
            _DetailRow(label: 'Colis traités', value: garage.parcelsCount.toString()),
            _DetailRow(label: 'Chiffre d\'affaires', value: '${garage.revenue.toInt()} FCFA'),
            _DetailRow(label: 'Créé le', value: _formatDate(garage.createdAt)),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Fermer'),
        ),
      ],
    ),
  );
}


  void _createUser() async {
  // Naviguer vers l'écran de création d'utilisateur
  final result = await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (context) => const UserFormScreen(isEditing: false),
    ),
  );
  
  if (result == true) {
    await _refreshData();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Utilisateur créé avec succès'), backgroundColor: Colors.green),
    );
  }
}

void _createGarage() async {
  final result = await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (context) => const GarageFormScreen(isEditing: false),
    ),
  );
  
  if (result == true) {
    await _refreshData();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Garage créé avec succès'), backgroundColor: Colors.green),
    );
  }
}

void _createParcel() async {
  final result = await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (context) => const ParcelFormScreen(isEditing: false),
    ),
  );
  
  if (result == true) {
    await _refreshData();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Colis créé avec succès'), backgroundColor: Colors.green),
    );
  }
}

void _showReports() {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (context) => const ReportsBottomSheet(),
  );
}

void _editUser(User user) async {
  final result = await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (context) => UserFormScreen(isEditing: true, user: user),
    ),
  );
  
  if (result == true) {
    await _refreshData();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Utilisateur modifié avec succès'), backgroundColor: Colors.green),
    );
  }
}

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} à ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }
}

class _DashboardCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;
  final String subtitle;
  final VoidCallback onTap;

  const _DashboardCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withAlpha(13),
                blurRadius: 10,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: color.withAlpha(26),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(icon, color: color, size: 20),
                  ),
                  const Spacer(),
                  Text(
                    value,
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
              Text(subtitle, style: const TextStyle(fontSize: 10, color: Colors.grey)),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.grey)),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}